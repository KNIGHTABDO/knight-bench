// DO / Workers type stubs for scaffold
type DurableObjectState = any; type DurableObjectNamespace = any; type DurableObjectId = any; type DurableObjectStub = any;// --- rate-limiter.ts ---
export interface IRateLimiter {
  consume(): Promise<void>; // resolves when token available, rejects if impossible
}

// A: Per-isolate best effort
export class InMemoryRateLimiter implements IRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  constructor(
    private readonly maxTokens = 230,
    private readonly windowMs = 60_000
  ) {
    this.tokens = maxTokens;
    this.lastRefillMs = Date.now();
  }
  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    const refillTokens = (elapsed / this.windowMs) * this.maxTokens;
    this.tokens = Math.min(this.maxTokens, this.tokens + refillTokens);
    this.lastRefillMs = now;
  }
  async consume(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const needed = 1 - this.tokens;
    const waitMs = (needed / this.maxTokens) * this.windowMs;
    await new Promise(r => setTimeout(r, waitMs + 50));
    return this.consume();
  }
}

// B: Durable Object backed
// Durable Object class (in separate file rate-limiter-do.ts)
export class RdRateLimiterDO {
  private tokens = 230;
  private lastRefill = Date.now();
  private maxTokens = 230;
  private windowMs = 60_000;
  constructor(private state: DurableObjectState) {}
  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + (elapsed / this.windowMs) * this.maxTokens);
    this.lastRefill = now;
  }
  async fetch(req: Request): Promise<Response> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      await this.state.storage.put({ tokens: this.tokens, lastRefill: this.lastRefill });
      return new Response("ok");
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.maxTokens) * this.windowMs);
    return new Response(JSON.stringify({ retryAfterMs: waitMs }), { status: 429, headers: { "Content-Type": "application/json" }});
  }
}

export class DurableRateLimiter implements IRateLimiter {
  constructor(private id: DurableObjectId, private ns: DurableObjectNamespace) {}
  // alternate ctor convenience: accept namespace + name in factory
  static fromName(ns: DurableObjectNamespace, name = "global") {
    return new DurableRateLimiter(ns.idFromName(name), ns);
  }
  async consume(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const stub = (this as any).ns ? (this as any).ns.get(this.id) : (globalThis as any).RD_RATE_LIMITER.get(this.id);
      // simpler: caller passes stub directly; for brevity we fetch:
      const doStub = (this as any).doNamespace ? (this as any).doNamespace.get(this.id) : null;
      // Actual implementation used via binding in worker:
      // const res = await env.RD_RATE_LIMITER.get(id).fetch(...)
      // Below is generic retry loop:
      const res = await (this as any).stubFetch(); // placeholder to illustrate
      if (res.ok) return;
      if (res.status === 429) {
        const { retryAfterMs } = await res.json() as { retryAfterMs: number };
        await new Promise(r => setTimeout(r, retryAfterMs + 50));
        continue;
      }
      throw new Error(`Rate limiter DO error ${res.status}`);
    }
  }
}

// Correct DO wrapper for worker.ts usage:
export class DurableRateLimiterFixed implements IRateLimiter {
  constructor(private stub: DurableObjectStub) {}
  async consume(): Promise<void> {
    while (true) {
      const res = await this.stub.fetch("http://do/consume");
      if (res.ok) return;
      if (res.status === 429) {
        const { retryAfterMs } = await res.json() as { retryAfterMs: number };
        await new Promise(r => setTimeout(r, Math.min(retryAfterMs, 2000)));
        continue;
      }
      throw new Error(`DO limiter error`);
    }
  }
}

export type RdErrorCode =
  | "AUTH_EXPIRED"        // 401
  | "PERMISSION_DENIED"   // 403 premium required
  | "INFIRINGING"         // 403 code 9 / file unavailable
  | "RATE_LIMITED"        // 429
  | "TRANSIENT_5XX"
  | "NOT_FOUND"
  | "BUSINESS_ERROR";     // magnet invalid, file list invalid etc

export class RdError extends Error {
  constructor(
    message: string,
    public readonly code: RdErrorCode,
    public readonly status: number,
    public readonly rdCode?: number, // RD's internal error code
    public readonly retryAfterMs?: number,
    public readonly causeErr?: unknown
  ) { super(message); this.name = "RdError"; }
}
export class AuthExpiredError extends RdError { constructor(m="Auth expired"){ super(m,"AUTH_EXPIRED",401); } }
export class PermissionError extends RdError { constructor(m="Premium required"){ super(m,"PERMISSION_DENIED",403); } }
export class InfringingFileError extends RdError { constructor(m="Infringing/unavailable"){ super(m,"INFIRINGING",403); } }
export class RateLimitedError extends RdError { constructor(rMs:number){ super("Rate limited", "RATE_LIMITED", 429, undefined, rMs); } }
export class TransientError extends RdError { constructor(s:number, c?:unknown){ super(`Transient ${s}`, "TRANSIENT_5XX", s, undefined, undefined, c); } }
export class PollingTimeoutError extends RdError { constructor(){ super("Torrent polling timed out","BUSINESS_ERROR",408); } }

export type RdTorrentStatus =
  | "magnet_conversion" | "magnet_error"
  | "waiting_files_selection"
  | "queued" | "downloading"
  | "compressing" | "uploading"
  | "downloaded"
  | "error" | "virus" | "dead";

interface PollOpts {
  baseDelayMs?: number; // 1000
  maxDelayMs?: number;  // 15000
  timeoutMs?: number;   // 600_000 (10m)
  autoSelect?: "all" | "largest" | false;
}

// rd-client.ts
const RD_BASE2 = "https://api.real-debrid.com/rest/1.0";

type Fetch = typeof fetch;

export interface RdClientOpts {
  token: string;
  rateLimiter?: IRateLimiter;
  fetchImpl?: Fetch;
  timeoutMs?: number; // fetch abort timeout
}

export interface UnrestrictResponse {
  id: string; filename: string; filesize: number; link: string;
  download: string; host: string; streamable?: boolean;
}
export interface AddMagnetResponse { id: string; uri: string; }
export interface TorrentInfo {
  id: string;
  hash: string;
  status: RdTorrentStatus;
  filename: string;
  bytes: number;
  progress: number;
  links: string[];
  files: { id: number; path: string; bytes: number; selected: number }[];
  error?: string;
}

function jitteredBackoff(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * exp); // full jitter
}

function sleep(ms: number){ return new Promise(r=>setTimeout(r, ms)); }

export class RealDebridClient {
  private fetch: Fetch;
  private limiter: IRateLimiter;
  private token: string;
  private reqTimeout: number;

  constructor(opts: RdClientOpts) {
    if (!opts.token) throw new Error("RD token required");
    this.token = opts.token;
    this.fetch = opts.fetchImpl ?? fetch;
    this.limiter = opts.rateLimiter ?? new InMemoryRateLimiter(230, 60_000);
    this.reqTimeout = opts.timeoutMs ?? 15_000;
  }

  private async request<T>(path: string, init: RequestInit & { idempotent?: boolean; retry?: number } = {}): Promise<T> {
    const { idempotent = false, retry = 0, ...fetchInit } = init;
    await this.limiter.consume();

    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), this.reqTimeout);

    let res: Response;
    try {
      res = await this.fetch(`${RD_BASE2}${path}`, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(fetchInit.headers as any),
        },
      });
    } catch (e) {
      clearTimeout(to);
      if (idempotent && retry < 2) {
        await sleep(jitteredBackoff(retry, 500, 4000));
        return this.request<T>(path, { ...init, retry: retry+1 } as any);
      }
      throw new TransientError(0, e);
    } finally { clearTimeout(to); }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return await res.json() as T;
    }

    // error parsing: RD returns {error, error_code}
    let body: any = {};
    try { body = await res.json(); } catch {}
    const rdCode: number | undefined = body.error_code;
    const msg = body.error || body.message || `RD error ${res.status}`;

    if (res.status === 401) throw new AuthExpiredError(msg);
    if (res.status === 403) {
      if (rdCode === 9 || rdCode === 10 || rdCode === 24 || /infringing|unavailable|unsupported/i.test(msg)) {
        throw new InfringingFileError(msg);
      }
      throw new PermissionError(msg);
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get("Retry-After")) || 5;
      const retryAfterMs = ra * 1000;
      if (retry < 4) {
        await sleep(retryAfterMs + jitteredBackoff(retry, 300, 2000));
        return this.request<T>(path, { ...init, retry: retry+1 } as any);
      }
      throw new RateLimitedError(retryAfterMs);
    }
    if (res.status >= 500 && res.status < 600) {
      if (idempotent && retry < 3) {
        await sleep(jitteredBackoff(retry, 500, 5000));
        return this.request<T>(path, { ...init, retry: retry+1 } as any);
      }
      throw new TransientError(res.status, body);
    }
    if (res.status === 404) throw new RdError(msg, "NOT_FOUND", 404, rdCode);
    throw new RdError(msg, "BUSINESS_ERROR", res.status, rdCode);
  }

  // --- Public API ---

  async unrestrictLink(link: string): Promise<UnrestrictResponse> {
    const form = new URLSearchParams({ link });
    return this.request<UnrestrictResponse>(`/unrestrict/link`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      idempotent: true, // effectively idempotent for same link
    });
  }

  async addMagnet(magnet: string, host = "real-debrid.com"): Promise<AddMagnetResponse> {
    // NOT idempotent -> caller must dedup
    const form = new URLSearchParams({ magnet, host });
    return this.request<AddMagnetResponse>(`/torrents/addMagnet`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      idempotent: false,
    });
  }

  // Safe version with hash dedup: list existing torrents first
  async addMagnetIdempotent(magnet: string): Promise<AddMagnetResponse> {
    const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/);
    if (hashMatch) {
      const existing = await this.listTorrents(0,1, undefined, hashMatch[1].toLowerCase()).catch(()=>[]);
      if (existing.length > 0) return { id: existing[0].id, uri: "" } as any;
    }
    return this.addMagnet(magnet);
  }

  async selectFiles(id: string, files: number[] | "all"): Promise<void> {
    const body = new URLSearchParams({ files: Array.isArray(files) ? files.join(",") : files });
    await this.request<void>(`/torrents/selectFiles/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      idempotent: true,
    });
  }

  async getTorrentInfo(id: string): Promise<TorrentInfo> {
    return this.request<TorrentInfo>(`/torrents/info/${id}`, { method: "GET", idempotent: true });
  }

  async listTorrents(offset=0, limit=50, page?:number, filterHash?:string): Promise<TorrentInfo[]> {
    const q = new URLSearchParams();
    if (offset) q.set("offset", String(offset));
    if (limit) q.set("limit", String(limit));
    if (page) q.set("page", String(page));
    // filter not native RD param, we filter client-side if provided
    const list = await this.request<TorrentInfo[]>(`/torrents?${q.toString()}`, { method: "GET", idempotent: true });
    if (filterHash) return list.filter(t=>t.hash.toLowerCase()===filterHash);
    return list;
  }

  async listDownloads(): Promise<UnrestrictResponse[]> {
    return this.request<UnrestrictResponse[]>(`/downloads`, { method:"GET", idempotent:true });
  }

  // --- Polling with state machine ---
  async pollUntilDownloaded(
    torrentId: string,
    opts: PollOpts = {}
  ): Promise<TorrentInfo> {
    const base = opts.baseDelayMs ?? 1000;
    const max = opts.maxDelayMs ?? 15000;
    const timeoutMs = opts.timeoutMs ?? 600_000;
    const start = Date.now();
    let attempt = 0;

    while (true) {
      if (Date.now() - start > timeoutMs) throw new PollingTimeoutError();

      const info = await this.getTorrentInfo(torrentId);
      switch (info.status) {
        case "downloaded":
          return info;

        case "magnet_conversion":
          break; // continue polling

        case "waiting_files_selection":
          if (opts.autoSelect !== false) {
            if (opts.autoSelect === "largest") {
              const largest = [...info.files].sort((a,b)=>b.bytes-a.bytes)[0];
              await this.selectFiles(torrentId, largest ? [largest.id] : "all");
            } else {
              await this.selectFiles(torrentId, "all");
            }
          } else {
            throw new RdError("Waiting for file selection", "BUSINESS_ERROR", 200);
          }
          break;

        case "queued":
          break; // waiting in queue

        case "downloading":
          break; // progress via info.progress

        case "compressing":
        case "uploading":
          break; // RD internal post-process, treat as pending

        case "magnet_error":
          throw new RdError(`Magnet error: ${info.error ?? "invalid magnet"}`, "BUSINESS_ERROR", 422);

        case "error":
          throw new RdError(`Torrent error: ${info.error ?? "unknown"}`, "BUSINESS_ERROR", 422);

        case "virus":
          throw new RdError("Torrent contains virus and was blocked", "INFIRINGING", 403);

        case "dead":
          throw new RdError("Torrent dead - no seeds / expired", "BUSINESS_ERROR", 410);

        default:
          // exhaustive check
          const _exhaustive: never = info.status as never;
          throw new RdError(`Unknown status ${info.status}`, "BUSINESS_ERROR", 500);
      }

      const d = jitteredBackoff(attempt++, base, max);
      await sleep(d);
    }
  }

  // Convenience: add magnet -> poll -> unrestrict all links
  async addAndUnrestrict(magnet: string, pollOpts?: PollOpts): Promise<{ torrent: TorrentInfo; files: UnrestrictResponse[] }> {
    const { id } = await this.addMagnet(magnet);
    const torrent = await this.pollUntilDownloaded(id, { autoSelect: "all", ...pollOpts });
    const unrestricted: UnrestrictResponse[] = [];
    for (const link of torrent.links) {
      try {
        unrestricted.push(await this.unrestrictLink(link));
      } catch (e) {
        if (e instanceof InfringingFileError) continue;
        throw e;
      }
    }
    return { torrent, files: unrestricted };
  }
}

