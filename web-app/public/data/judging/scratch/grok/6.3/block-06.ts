export interface RdClientOptions {
  /** Server-side only secret. Never pass to the browser. */
  apiToken: string;
  baseUrl?: string;
  rateLimiter?: RateLimiter;
  /** Max retries for retryable errors on idempotent (or analyzed-safe) calls */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class RealDebridClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RdClientOptions) {
    if (!opts.apiToken) {
      throw new Error("RealDebridClient requires apiToken (server-side only)");
    }
    this.token = opts.apiToken;
    this.baseUrl = opts.baseUrl ?? "https://api.real-debrid.com/rest/1.0";
    this.limiter = opts.rateLimiter ?? new IsolateTokenBucket();
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  // ---------- low-level ----------

  private async raw(
    method: string,
    path: string,
    init: {
      form?: Record<string, string>;
      query?: Record<string, string | number | undefined>;
      /** If false, do not retry even on transient errors */
      retryable?: boolean;
      /** Custom retry policy after a failed attempt; return true to retry */
      onBeforeRetry?: (err: RdApiError, attempt: number) => Promise<boolean> | boolean;
    } = {},
  ): Promise<Response> {
    const retryable = init.retryable !== false;
    let attempt = 0;

    for (;;) {
      await this.limiter.acquire(1);

      const url = new URL(this.baseUrl + path);
      if (init.query) {
        for (const [k, v] of Object.entries(init.query)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };

      let body: string | undefined;
      if (init.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(init.form).toString();
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), { method, headers, body });
      } catch (e) {
        const err = new RdApiError(
          e instanceof Error ? e.message : "Network error",
          "NETWORK",
          undefined,
          true,
        );
        if (!retryable || attempt >= this.maxRetries) throw err;
        if (init.onBeforeRetry && !(await init.onBeforeRetry(err, attempt))) throw err;
        await sleep(computeDelay(attempt++, {
          initialMs: 500,
          maxMs: 8_000,
          multiplier: 2,
          jitterRatio: 0.25,
          hardTimeoutMs: 0,
        }));
        continue;
      }

      if (res.ok) return res;

      const text = await res.text();
      const err = classifyHttpError(res.status, text, res.headers);

      if (!retryable || !err.retryable || attempt >= this.maxRetries) throw err;
      if (init.onBeforeRetry && !(await init.onBeforeRetry(err, attempt))) throw err;

      const backoff = err.retryAfterMs ??
        computeDelay(attempt, {
          initialMs: 500,
          maxMs: 8_000,
          multiplier: 2,
          jitterRatio: 0.25,
          hardTimeoutMs: 0,
        });
      attempt++;
      await sleep(backoff);
    }
  }

  private async json<T>(
    method: string,
    path: string,
    init?: Parameters<RealDebridClient["raw"]>[2],
  ): Promise<T> {
    const res = await this.raw(method, path, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---------- public API ----------

  /**
   * Unrestrict a hoster link.
   * Retry: allowed on 429/5xx/network only. May create duplicate download entries.
   */
  async unrestrictLink(link: string, password?: string): Promise<RdUnrestrictLink> {
    const form: Record<string, string> = { link };
    if (password) form.password = password;
    return this.json<RdUnrestrictLink>("POST", "/unrestrict/link", {
      form,
      retryable: true, // analyzed: conditionally safe
    });
  }

  /**
   * Add a magnet.
   * Retry: NOT blindly safe. We disable automatic POST retries after any HTTP response.
   * Network-only retries are limited; prefer findTorrentByHash after failures.
   */
  async addMagnet(magnet: string): Promise<RdAddedMagnet> {
    return this.json<RdAddedMagnet>("POST", "/torrents/addMagnet", {
      form: { magnet },
      // Allow limited retries only for pure network errors; on HTTP error body, stop.
      retryable: true,
      onBeforeRetry: (err) => err.code === "NETWORK",
    });
  }

  /**
   * Safer add: try addMagnet; on ambiguous failure, list and match hash if provided.
   */
  async addMagnetSafe(magnet: string, infoHash?: string): Promise<RdAddedMagnet> {
    try {
      return await this.addMagnet(magnet);
    } catch (e) {
      if (!(e instanceof RdApiError)) throw e;
      // Auth/permission: never recover via list
      if (e.code === "AUTH_EXPIRED" || e.code === "PERMISSION_REQUIRED") throw e;

      const hash = (infoHash ?? extractInfoHashFromMagnet(magnet))?.toLowerCase();
      if (!hash) throw e;

      const existing = await this.findTorrentByHash(hash);
      if (existing) return { id: existing.id, uri: magnet };
      throw e;
    }
  }

  /** Select files for a torrent. `files` = "all" or comma-separated file ids. Idempotent. */
  async selectFiles(id: string, files: string = "all"): Promise<void> {
    await this.raw("POST", `/torrents/selectFiles/${encodeURIComponent(id)}`, {
      form: { files },
      retryable: true,
    });
  }

  /** GET torrent info — safe to retry. */
  async getTorrentInfo(id: string): Promise<RdTorrentInfo> {
    return this.json<RdTorrentInfo>("GET", `/torrents/info/${encodeURIComponent(id)}`, {
      retryable: true,
    });
  }

  /** List torrents — safe to retry. */
  async listTorrents(params?: {
    offset?: number;
    page?: number;
    limit?: number;
    filter?: string;
  }): Promise<RdTorrentInfo[]> {
    return this.json<RdTorrentInfo[]>("GET", "/torrents", {
      query: {
        offset: params?.offset,
        page: params?.page,
        limit: params?.limit ?? 50,
        filter: params?.filter,
      },
      retryable: true,
    });
  }

  async findTorrentByHash(hash: string): Promise<RdTorrentInfo | undefined> {
    const list = await this.listTorrents({ limit: 100 });
    const h = hash.toLowerCase();
    return list.find((t) => t.hash?.toLowerCase() === h);
  }

  /** List downloads — safe to retry. */
  async listDownloads(params?: {
    offset?: number;
    page?: number;
    limit?: number;
  }): Promise<RdDownloadItem[]> {
    return this.json<RdDownloadItem[]>("GET", "/downloads", {
      query: {
        offset: params?.offset,
        page: params?.page,
        limit: params?.limit ?? 50,
      },
      retryable: true,
    });
  }

  /**
   * High-level: add magnet → wait for file selection window → select files →
   * poll until downloaded (or terminal failure / hard timeout).
   */
  async downloadMagnetToCompletion(
    magnet: string,
    options?: {
      files?: string; // default "all"
      infoHash?: string;
      backoff?: BackoffOptions;
      onStatus?: (info: RdTorrentInfo, decision: PollDecision) => void;
    },
  ): Promise<RdTorrentInfo> {
    const added = await this.addMagnetSafe(magnet, options?.infoHash);

    // Wait until we leave magnet_conversion and reach waiting_files_selection (or later).
    const ready = await this.waitForFileSelectionOrBeyond(added.id, options?.backoff);
    if (ready.status === "waiting_files_selection") {
      await this.selectFiles(added.id, options?.files ?? "all");
    }

    return pollUntilDownloaded(
      () => this.getTorrentInfo(added.id),
      options?.backoff,
      options?.onStatus,
    );
  }

  private async waitForFileSelectionOrBeyond(
    id: string,
    backoff?: BackoffOptions,
  ): Promise<RdTorrentInfo> {
    const opts: Required<BackoffOptions> = {
      initialMs: backoff?.initialMs ?? 800,
      maxMs: backoff?.maxMs ?? 10_000,
      multiplier: backoff?.multiplier ?? 1.8,
      jitterRatio: backoff?.jitterRatio ?? 0.2,
      hardTimeoutMs: backoff?.hardTimeoutMs ?? 5 * 60 * 1000,
    };
    const deadline = Date.now() + opts.hardTimeoutMs;
    let attempt = 0;

    for (;;) {
      if (Date.now() > deadline) {
        throw new RdApiError("Timed out waiting for magnet conversion", "TIMEOUT");
      }
      const info = await this.getTorrentInfo(id);
      const decision = decideTorrentStatus(info.status);

      if (decision.kind === "failure") {
        throw new RdApiError(decision.message, "UNKNOWN", undefined, false, undefined, info);
      }
      if (info.status === "waiting_files_selection") return info;
      // Already past selection (e.g. auto or previously selected)
      if (
        info.status === "queued" ||
        info.status === "downloading" ||
        info.status === "downloaded"
      ) {
        return info;
      }
      if (info.status === "magnet_conversion") {
        const delay = computeDelay(attempt++, opts);
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
        continue;
      }
      // Any other handled status already returned or threw; default:
      throw new RdApiError(
        `Unexpected torrent status while waiting for selection: ${info.status}`,
        "UNEXPECTED_STATUS",
        undefined,
        false,
        undefined,
        info,
      );
    }
  }
}

/** Extract btih from magnet URI if present. */
export function extractInfoHashFromMagnet(magnet: string): string | undefined {
  const m = /btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.exec(magnet);
  return m?.[1];
}
