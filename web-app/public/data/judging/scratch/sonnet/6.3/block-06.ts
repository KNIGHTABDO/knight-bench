// ============================================================================
// real-debrid-client.ts
// ============================================================================

import { RateLimiter } from "./rate-limiter";
import { withRetry } from "./retry";
import {
  RdApiError,
  RdRateLimitError,
  RdTransientServerError,
  classifyRdError,
} from "./errors";
import { RdTorrentInfo } from "./torrent-poller";

const RD_BASE_URL = "https://api.real-debrid.com/rest/1.0";

export interface UnrestrictResult {
  id: string;
  filename: string;
  filesize: number;
  link: string; // original hoster link
  download: string; // direct, unrestricted link
  mimeType: string;
}

export interface AddMagnetResult {
  id: string;
  uri: string; // magnet status page on RD
}

export interface RdDownloadItem {
  id: string;
  filename: string;
  download: string;
  filesize: number;
  generated: string; // ISO timestamp
}

/**
 * Real-Debrid REST client. Holds the API token in a private field only —
 * this class must be instantiated ONLY inside the Worker (never sent to,
 * or reconstructed from, client-supplied data). Callers interact with the
 * Worker's own endpoints, never with this client directly.
 */
export class RealDebridClient {
  #token: string; // private class field: not enumerable via Object.keys/JSON.stringify of `this`

  constructor(
    token: string,
    private readonly limiter: RateLimiter,
  ) {
    this.#token = token;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { retry?: boolean } = {},
  ): Promise<T> {
    await this.limiter.acquire();

    const doFetch = async (): Promise<T> => {
      const res = await fetch(`${RD_BASE_URL}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${this.#token}`,
        },
      });

      if (!res.ok) {
        throw await classifyRdError(res);
      }

      // Some RD endpoints (e.g. selectFiles, addTorrent w/ 202) return empty bodies.
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    };

    if (init.retry === false) {
      return doFetch();
    }

    return withRetry(
      () => doFetch(),
      (err) => err instanceof RdRateLimitError || err instanceof RdTransientServerError,
      { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 10_000 },
    );
  }

  /** Idempotent, safe to retry (see idempotency table). */
  async unrestrictLink(link: string): Promise<UnrestrictResult> {
    return this.request<UnrestrictResult>("/unrestrict/link", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ link }).toString(),
    });
  }

  /** NOT safe to blindly retry on ambiguous failures — see addMagnetIdempotent below. */
  async addMagnet(magnet: string): Promise<AddMagnetResult> {
    return this.request<AddMagnetResult>("/torrents/addMagnet", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ magnet }).toString(),
      retry: false, // handled explicitly below, not via generic retry wrapper
    });
  }

  /**
   * Idempotency-safe wrapper for addMagnet per the analysis in section 3:
   * only retries when we can prove the previous attempt did not reach RD
   * (network-level failure before any response), or when a pre-existing
   * torrent with the same magnet can be found and reused instead of
   * creating a duplicate.
   */
  async addMagnetIdempotent(magnet: string, magnetHash: string): Promise<AddMagnetResult> {
    try {
      return await this.addMagnet(magnet);
    } catch (err) {
      if (err instanceof RdApiError) {
        // Any error that reached RD (i.e. we got an HTTP response, even an
        // error one) means we cannot safely assume the add did not happen.
        // Reconcile via listTorrents before ever calling addMagnet again.
        const existing = await this.findTorrentByHash(magnetHash);
        if (existing) return { id: existing.id, uri: "" };
        throw err; // genuinely failed and nothing was created: safe to surface
      }
      // A raw network-layer throw (fetch itself rejected, e.g. TypeError
      // "Failed to fetch") means the request plausibly never reached RD.
      // Single retry only, then reconcile the same way if it fails again.
      try {
        return await this.addMagnet(magnet);
      } catch {
        const existing = await this.findTorrentByHash(magnetHash);
        if (existing) return { id: existing.id, uri: "" };
        throw err;
      }
    }
  }

  private async findTorrentByHash(magnetHash: string): Promise<RdTorrentInfo | undefined> {
    const list = await this.listTorrents();
    return list.find((t) => t.id.toLowerCase().includes(magnetHash.toLowerCase()));
    // NOTE: RD's /torrents list response does not reliably expose the raw
    // magnet hash in all API versions in a documented way I can verify here;
    // in production, prefer matching on `filename` plus recency, or maintain
    // your own mapping of (magnetHash -> RD torrent id) in your own storage
    // (KV/D1) at addMagnet time so this reconciliation doesn't depend on
    // RD's response shape at all. This is flagged as an assumption.
  }

  async selectFiles(torrentId: string, fileIds: number[] | "all"): Promise<void> {
    await this.request<void>(`/torrents/selectFiles/${torrentId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ files: fileIds === "all" ? "all" : fileIds.join(",") }).toString(),
    });
  }

  /** Pure read: safe to retry. */
  async getTorrentInfo(torrentId: string): Promise<RdTorrentInfo> {
    return this.request<RdTorrentInfo>(`/torrents/info/${torrentId}`, { method: "GET" });
  }

  /** Pure read: safe to retry. */
  async listDownloads(page = 1, limit = 50): Promise<RdDownloadItem[]> {
    return this.request<RdDownloadItem[]>(`/downloads?page=${page}&limit=${limit}`, { method: "GET" });
  }

  /** Pure read: safe to retry. Used for addMagnet reconciliation above. */
  async listTorrents(page = 1, limit = 50): Promise<RdTorrentInfo[]> {
    return this.request<RdTorrentInfo[]>(`/torrents?page=${page}&limit=${limit}`, { method: "GET" });
  }
}
