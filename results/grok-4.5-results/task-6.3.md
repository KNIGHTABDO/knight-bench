# Real-Debrid TypeScript Client for Cloudflare Workers

This document provides a complete TypeScript client module for the Real-Debrid (RD) REST API designed for Cloudflare Workers: rate limiting under the Workers execution model, torrent polling with exponential backoff + jitter and a full status state machine, typed error taxonomy with idempotency-aware retries, and a Worker boundary that never exposes the API token to the browser.

**API base:** `https://api.real-debrid.com/rest/1.0`  
**Auth:** `Authorization: Bearer <token>`  
**HTTP:** `fetch` only (no external libraries)

---

## 1. Workers execution model and rate limiting

### Constraint

Cloudflare Workers are **stateless isolates**. A single HTTP request is handled by one isolate for a short lifetime. There is **no guarantee** that:

- the same isolate serves the next request,
- timers (`setInterval` / long-lived `setTimeout`) survive across requests,
- in-memory counters are shared across concurrent isolates or POPs.

Therefore a classic process-wide token bucket with `setInterval` refill is **not reliable** as a global RD rate limiter.

RD allows roughly **~250 requests/minute** (~4.16 req/s). Overshooting yields `429`.

### Two solutions and when to use each

| Approach | How it works | When appropriate |
|---|---|---|
| **Per-isolate best-effort limiter** | In-memory token bucket / min spacing inside one isolate for the duration of a single Worker invocation (or while the isolate is warm). | Single-request pipelines (unrestrict → add magnet → select → poll → list) where all RD calls happen **inside one request**. Cheap, no extra infra. Does **not** protect multi-instance global budget. |
| **Durable Object token bucket** | One DO owns the global token state; every RD call (or batch of calls) acquires a permit via `stub.fetch` / RPC before hitting RD. Refill based on wall clock inside the DO. | Multiple concurrent clients / Workers / cron triggers that must share the **account-wide** 250/min budget. Correct under concurrency; adds latency and DO cost. |

**Recommendation for this client:**

- Implement a **per-invocation `RateLimiter`** used by the RD client for spacing calls during one pipeline (required and always used).
- Optionally inject a **`GlobalRateGate`** interface backed by a Durable Object when you need account-wide enforcement across isolates.

```ts
/**
 * Workers constraint: no reliable cross-request setInterval.
 * - Per-isolate: best-effort spacing within one invocation (and warm isolate memory).
 * - Durable Object: true shared token bucket when many invocations share one RD account.
 */
export interface RateLimiter {
  /** Acquire permission for n RD API calls. Resolves when allowed. */
  acquire(n?: number): Promise<void>;
}

/** Token bucket suitable for a single Worker invocation (or warm isolate). */
export class IsolateTokenBucket implements RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number = 250,
    private readonly refillPerMs: number = 250 / 60_000, // 250/min
    private readonly minSpacingMs: number = 250, // ~4 rps ceiling as safety
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.lastRefillMs);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillMs = now;
  }

  async acquire(n = 1): Promise<void> {
    // No setInterval: refill is lazy on each acquire using wall clock.
    // sleep via Promise + setTimeout is fine *within* one request.
    for (;;) {
      const now = Date.now();
      this.refill(now);
      if (this.tokens >= n) {
        this.tokens -= n;
        // min spacing reduces burst even if tokens remain
        await sleep(this.minSpacingMs);
        return;
      }
      const deficit = n - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await sleep(Math.min(Math.max(waitMs, this.minSpacingMs), 5_000));
    }
  }
}

/**
 * Optional global gate: Worker calls this before each RD request.
 * Implementation lives in a Durable Object (not shown in full; interface only).
 *
 * Example DO design:
 * - state: { tokens, lastRefillMs }
 * - on alarm or on acquire: refill 250/min from wall clock
 * - acquire blocks (or returns 429-to-worker) until token available
 */
export interface GlobalRateGate {
  acquire(n?: number): Promise<void>;
}

export class CompositeRateLimiter implements RateLimiter {
  constructor(
    private readonly local: RateLimiter,
    private readonly global?: GlobalRateGate,
  ) {}

  async acquire(n = 1): Promise<void> {
    if (this.global) await this.global.acquire(n);
    await this.local.acquire(n);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

---

## 2. Error taxonomy

```ts
export type RdErrorCode =
  | "AUTH_EXPIRED"           // 401
  | "PERMISSION_REQUIRED"    // 403 (premium / hoster permission)
  | "INFRINGING_OR_UNAVAILABLE" // 503 / certain 404 / RD error bodies for unavailable hosts/files
  | "RATE_LIMITED"           // 429
  | "TRANSIENT_UPSTREAM"     // 5xx (except classified unavailable)
  | "BAD_REQUEST"            // 400 / validation
  | "NOT_FOUND"              // 404 (resource missing — may be non-retryable)
  | "NETWORK"                // fetch threw
  | "TIMEOUT"                // client hard timeout (polling)
  | "UNEXPECTED_STATUS"      // unhandled torrent status
  | "UNKNOWN";

export class RdApiError extends Error {
  readonly name = "RdApiError";
  constructor(
    message: string,
    readonly code: RdErrorCode,
    readonly httpStatus?: number,
    readonly retryable: boolean = false,
    readonly retryAfterMs?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = Number(header);
  if (!Number.isNaN(asInt) && asInt >= 0) return asInt * 1000;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

function classifyHttpError(
  status: number,
  bodyText: string,
  headers: Headers,
): RdApiError {
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* keep text */
  }

  const msg =
    typeof body === "object" && body && "error" in body
      ? String((body as { error: unknown }).error)
      : bodyText || `HTTP ${status}`;

  const lower = msg.toLowerCase();

  if (status === 401) {
    return new RdApiError(msg || "Authentication expired or invalid", "AUTH_EXPIRED", 401, false, undefined, body);
  }
  if (status === 403) {
    return new RdApiError(
      msg || "Permission or premium required",
      "PERMISSION_REQUIRED",
      403,
      false,
      undefined,
      body,
    );
  }
  if (status === 429) {
    return new RdApiError(
      msg || "Rate limited by Real-Debrid",
      "RATE_LIMITED",
      429,
      true,
      parseRetryAfter(headers.get("Retry-After")) ?? 2_000,
      body,
    );
  }

  // Infringing / unavailable: RD often uses 503 for hoster temporary unavailability,
  // and error messages mentioning unavailable / infringing / not supported.
  const unavailableHints =
    lower.includes("infring") ||
    lower.includes("unavailable") ||
    lower.includes("not available") ||
    lower.includes("hoster unsupported") ||
    lower.includes("unsupported hoster") ||
    lower.includes("file unavailable");

  if (status === 503 && unavailableHints) {
    return new RdApiError(msg, "INFRINGING_OR_UNAVAILABLE", 503, false, undefined, body);
  }
  if (status === 404 && unavailableHints) {
    return new RdApiError(msg, "INFRINGING_OR_UNAVAILABLE", 404, false, undefined, body);
  }

  if (status >= 500) {
    return new RdApiError(msg || `Upstream ${status}`, "TRANSIENT_UPSTREAM", status, true, 1_000, body);
  }
  if (status === 404) {
    return new RdApiError(msg || "Not found", "NOT_FOUND", 404, false, undefined, body);
  }
  if (status >= 400 && status < 500) {
    return new RdApiError(msg || `Bad request ${status}`, "BAD_REQUEST", status, false, undefined, body);
  }
  return new RdApiError(msg || `HTTP ${status}`, "UNKNOWN", status, false, undefined, body);
}
```

### Idempotency analysis (retries)

| Endpoint | Method | Idempotent? | Safe to retry on 429/5xx/network? |
|---|---|---|---|
| `POST /unrestrict/link` | POST | **Mostly yes** for same link (returns same unrestricted URL / download resource semantics). Side effect is creating a download entry; duplicate calls may create **duplicate download list entries**. | **Conditionally safe** if duplicates in `/downloads` are acceptable. Prefer single-flight; retry only on 429/5xx/network, not on 4xx. |
| `POST /torrents/addMagnet` | POST | **No (not strictly).** Each successful call can create a **new torrent** (or return existing id depending on RD state for same magnet — **not contractually guaranteed**). | **Not safely retryable after ambiguity.** Retry **only** if the request clearly never reached the server (network error before response) **or** you de-dupe by listing torrents for the same hash. On 429/5xx **with a response**, prefer **list torrents** and match `hash` rather than blindly re-POST. |
| `POST /torrents/selectFiles/{id}` | POST | **Yes** for same file selection (setting selection again is effectively the same intent). | **Yes** for 429/5xx/network. |
| `GET /torrents/info/{id}` | GET | **Yes** | **Yes** |
| `GET /torrents` | GET | **Yes** | **Yes** |
| `GET /downloads` | GET | **Yes** | **Yes** |

**Explicit answer — is “add magnet” retry-safe?**  
**No, not blindly.** `POST /torrents/addMagnet` is a **non-idempotent create**. Safe pattern:

1. On clear network failure with no HTTP response: retry with care, or compute infohash and `GET /torrents` to see if it already exists.
2. On `429` / `5xx` **with** a body/status: **do not** immediately re-add; first list torrents and match by hash if you have it; only re-POST if absent.
3. On `401` / `403` / `4xx` validation: **never** retry.

Unrestrict is closer to safe but can pollute the downloads list; still only retry transient classes.

---

## 3. Torrent status state machine

RD torrent `status` values (handle **every** one explicitly):

| Status | Meaning | Client action |
|---|---|---|
| `magnet_conversion` | Magnet → metadata in progress | Keep polling |
| `waiting_files_selection` | Metadata ready; files not selected | Caller must `selectFiles` (pipeline does this once) or treat as waiting if already selected mid-race |
| `queued` | Waiting for download slot | Keep polling |
| `downloading` | Actively downloading | Keep polling |
| `downloaded` | Complete | **Success terminal** |
| `error` | Failed | **Failure terminal** |
| `virus` | Flagged | **Failure terminal** |
| `dead` | Dead torrent | **Failure terminal** |

```ts
export type RdTorrentStatus =
  | "magnet_conversion"
  | "waiting_files_selection"
  | "queued"
  | "downloading"
  | "downloaded"
  | "error"
  | "virus"
  | "dead";

export type PollDecision =
  | { kind: "continue" }
  | { kind: "success" }
  | { kind: "needs_file_selection" }
  | { kind: "failure"; reason: RdTorrentStatus; message: string };

export function decideTorrentStatus(status: string): PollDecision {
  switch (status as RdTorrentStatus) {
    case "magnet_conversion":
      return { kind: "continue" };
    case "waiting_files_selection":
      return { kind: "needs_file_selection" };
    case "queued":
      return { kind: "continue" };
    case "downloading":
      return { kind: "continue" };
    case "downloaded":
      return { kind: "success" };
    case "error":
      return {
        kind: "failure",
        reason: "error",
        message: "Torrent failed (status=error)",
      };
    case "virus":
      return {
        kind: "failure",
        reason: "virus",
        message: "Torrent flagged as virus (status=virus)",
      };
    case "dead":
      return {
        kind: "failure",
        reason: "dead",
        message: "Torrent is dead (status=dead)",
      };
    default:
      // Unknown future status: do not silently succeed
      throw new RdApiError(
        `Unexpected torrent status: ${status}`,
        "UNEXPECTED_STATUS",
        undefined,
        false,
        undefined,
        { status },
      );
  }
}
```

### Polling: exponential backoff + jitter + hard timeout

```ts
export interface BackoffOptions {
  initialMs?: number;   // default 1000
  maxMs?: number;       // default 15000
  multiplier?: number;  // default 1.8
  jitterRatio?: number; // default 0.2 (±20%)
  hardTimeoutMs?: number; // default 15 * 60 * 1000
}

function computeDelay(attempt: number, opts: Required<BackoffOptions>): number {
  const exp = Math.min(opts.maxMs, opts.initialMs * opts.multiplier ** attempt);
  const jitter = exp * opts.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exp + jitter));
}

export async function pollUntilDownloaded(
  getInfo: () => Promise<RdTorrentInfo>,
  options: BackoffOptions = {},
  onStatus?: (info: RdTorrentInfo, decision: PollDecision) => void,
): Promise<RdTorrentInfo> {
  const opts: Required<BackoffOptions> = {
    initialMs: options.initialMs ?? 1_000,
    maxMs: options.maxMs ?? 15_000,
    multiplier: options.multiplier ?? 1.8,
    jitterRatio: options.jitterRatio ?? 0.2,
    hardTimeoutMs: options.hardTimeoutMs ?? 15 * 60 * 1000,
  };

  const deadline = Date.now() + opts.hardTimeoutMs;
  let attempt = 0;

  for (;;) {
    if (Date.now() > deadline) {
      throw new RdApiError(
        `Polling timed out after ${opts.hardTimeoutMs}ms`,
        "TIMEOUT",
        undefined,
        false,
      );
    }

    const info = await getInfo();
    const decision = decideTorrentStatus(info.status);
    onStatus?.(info, decision);

    switch (decision.kind) {
      case "success":
        return info;
      case "failure":
        throw new RdApiError(decision.message, "UNKNOWN", undefined, false, undefined, {
          status: decision.reason,
          id: info.id,
        });
      case "needs_file_selection":
        // Pipeline should have selected files; if we still see this, surface explicitly.
        throw new RdApiError(
          "Torrent is waiting for file selection",
          "BAD_REQUEST",
          undefined,
          false,
          undefined,
          info,
        );
      case "continue":
        break;
    }

    const delay = computeDelay(attempt++, opts);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RdApiError(`Polling timed out after ${opts.hardTimeoutMs}ms`, "TIMEOUT");
    }
    await sleep(Math.min(delay, remaining));
  }
}
```

---

## 4. Types for RD resources (minimal)

```ts
export interface RdTorrentInfo {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  host: string;
  split: number;
  progress: number;
  status: RdTorrentStatus | string;
  added: string;
  links: string[];
  files?: Array<{
    id: number;
    path: string;
    bytes: number;
    selected: number;
  }>;
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface RdAddedMagnet {
  id: string;
  uri: string;
}

export interface RdUnrestrictLink {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  crc: number;
  download: string; // direct download URL
  streamable: number;
}

export interface RdDownloadItem {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  download: string;
  generated: string;
}
```

---

## 5. Core client (`fetch` only)

```ts
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
```

---

## 6. Worker boundary design — never leak the API token

The RD token is a **full-account secret**. It must live only in Worker secrets / server config. Browsers and mobile apps call **your** Worker routes; the Worker holds the token and calls RD.

```
┌─────────────┐     HTTPS (no RD token)      ┌──────────────────────────┐
│   Browser   │ ───────────────────────────► │  Cloudflare Worker       │
│  (untrusted)│ ◄─────────────────────────── │  env.REAL_DEBRID_TOKEN   │
└─────────────┘   JSON results only          │  RealDebridClient(token) │
                                             └────────────┬─────────────┘
                                                          │ Authorization: Bearer <token>
                                                          ▼
                                             ┌──────────────────────────┐
                                             │  api.real-debrid.com     │
                                             └──────────────────────────┘
```

### Example Worker module

```ts
export interface Env {
  REAL_DEBRID_TOKEN: string; // wrangler secret
  // Optional: RD_RATE_LIMITER: DurableObjectNamespace;
}

/**
 * Public API surface (examples):
 *   POST /api/unrestrict     { link }
 *   POST /api/torrents       { magnet, files? }
 *   GET  /api/torrents/:id
 *   GET  /api/downloads
 *
 * Never accept a client-supplied RD token.
 * Never echo Authorization headers from upstream RD.
 * Never put the token in response bodies, logs shipped to the client, or URLs.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // --- auth for *your* users (session / JWT / Cloudflare Access) ---
    // Not the RD token. Example placeholder:
    const userOk = await authorizeAppUser(request, env);
    if (!userOk) return json({ error: "unauthorized" }, 401);

    const rd = new RealDebridClient({
      apiToken: env.REAL_DEBRID_TOKEN,
      rateLimiter: new IsolateTokenBucket(),
      // rateLimiter: new CompositeRateLimiter(new IsolateTokenBucket(), doGate),
    });

    try {
      if (request.method === "POST" && url.pathname === "/api/unrestrict") {
        const { link, password } = await request.json() as { link?: string; password?: string };
        if (!link) return json({ error: "link required" }, 400);
        const result = await rd.unrestrictLink(link, password);
        // Return only fields the client needs; strip nothing sensitive from RD beyond token
        // (RD token never appears here).
        return json({
          id: result.id,
          filename: result.filename,
          filesize: result.filesize,
          download: result.download,
          mimeType: result.mimeType,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/torrents") {
        const body = await request.json() as {
          magnet?: string;
          files?: string;
          wait?: boolean;
        };
        if (!body.magnet) return json({ error: "magnet required" }, 400);

        if (body.wait) {
          // Note: long polls may hit Worker subrequest / CPU / wall-time limits.
          // For large torrents prefer: start job, store torrent id, client polls your GET.
          const info = await rd.downloadMagnetToCompletion(body.magnet, {
            files: body.files ?? "all",
            backoff: { hardTimeoutMs: 50_000 }, // stay under Worker limits if needed
          });
          return json(sanitizeTorrent(info));
        }

        const added = await rd.addMagnetSafe(body.magnet);
        // Optionally kick select+poll via waitUntil for async completion
        ctx.waitUntil(
          (async () => {
            try {
              const info = await rd.getTorrentInfo(added.id);
              if (info.status === "waiting_files_selection" || info.status === "magnet_conversion") {
                await rd.downloadMagnetToCompletion(body.magnet!, {
                  files: body.files ?? "all",
                  infoHash: extractInfoHashFromMagnet(body.magnet!),
                });
              }
            } catch {
              // log server-side only
            }
          })(),
        );
        return json({ id: added.id }, 202);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/torrents/")) {
        const id = url.pathname.split("/").pop()!;
        const info = await rd.getTorrentInfo(id);
        return json(sanitizeTorrent(info));
      }

      if (request.method === "GET" && url.pathname === "/api/downloads") {
        const items = await rd.listDownloads({ limit: 50 });
        return json(items.map(sanitizeDownload));
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof RdApiError) {
        const status =
          e.code === "AUTH_EXPIRED"
            ? 502 // your API: upstream auth misconfigured — do not imply end-user 401 for RD
            : e.code === "PERMISSION_REQUIRED"
              ? 403
              : e.code === "RATE_LIMITED"
                ? 429
                : e.code === "INFRINGING_OR_UNAVAILABLE"
                  ? 451 // or 422/503 — choose product policy
                  : e.code === "TIMEOUT"
                    ? 504
                    : e.code === "TRANSIENT_UPSTREAM"
                      ? 502
                      : 400;

        // Never include env.REAL_DEBRID_TOKEN or raw Authorization in error payloads.
        return json(
          {
            error: e.code,
            message: e.message,
            retryable: e.retryable,
            retryAfterMs: e.retryAfterMs,
          },
          status,
          e.retryAfterMs
            ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) }
            : undefined,
        );
      }
      return json({ error: "internal_error" }, 500);
    }
  },
};

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function sanitizeTorrent(info: RdTorrentInfo) {
  return {
    id: info.id,
    filename: info.filename,
    hash: info.hash,
    bytes: info.bytes,
    progress: info.progress,
    status: info.status,
    links: info.links,
    ended: info.ended,
  };
}

function sanitizeDownload(d: RdDownloadItem) {
  return {
    id: d.id,
    filename: d.filename,
    filesize: d.filesize,
    download: d.download,
    generated: d.generated,
    host: d.host,
  };
}

async function authorizeAppUser(request: Request, _env: Env): Promise<boolean> {
  // Implement session/JWT/API-key for *your* product.
  // Must be independent of Real-Debrid credentials.
  return request.headers.get("Authorization")?.startsWith("Bearer ") === true;
}
```

### Boundary rules (checklist)

1. Store token as `wrangler secret put REAL_DEBRID_TOKEN` (or dashboard secret) — not in source, not in `wrangler.toml` plain text for production.
2. Client never sends RD token; Worker injects `Authorization` only on egress to `api.real-debrid.com`.
3. Do not proxy arbitrary RD paths with client-controlled URLs (SSRF / token abuse).
4. Map RD `401` to an **ops** failure (misconfigured secret), not “user logged out of your app,” unless you intentionally surface setup errors.
5. Log carefully: avoid logging full `Authorization` headers or the secret.
6. Long torrent downloads: prefer **async** (return torrent id + client polls your Worker) so you stay within Worker request duration limits; use `waitUntil` only for short background work.

---

## 7. Optional Durable Object global rate gate (sketch)

Use when many isolates share one RD account:

```ts
// worker.ts binding: RD_RATE_LIMITER (Durable Object)

export class RdRateLimiterDO {
  private tokens = 250;
  private lastRefillMs = Date.now();
  private readonly capacity = 250;
  private readonly refillPerMs = 250 / 60_000;

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const n = Number(new URL(request.url).searchParams.get("n") ?? "1");
    await this.state.blockConcurrencyWhile(async () => {
      for (;;) {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.lastRefillMs);
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
        this.lastRefillMs = now;
        if (this.tokens >= n) {
          this.tokens -= n;
          return;
        }
        const waitMs = Math.ceil((n - this.tokens) / this.refillPerMs);
        await sleep(Math.min(waitMs, 1000));
      }
    });
    return new Response("ok");
  }
}

export class DurableObjectRateGate implements GlobalRateGate {
  constructor(private ns: DurableObjectNamespace, private name = "rd-global") {}

  async acquire(n = 1): Promise<void> {
    const id = this.ns.idFromName(this.name);
    const stub = this.ns.get(id);
    const res = await stub.fetch(`https://do/acquire?n=${n}`);
    if (!res.ok) throw new RdApiError("Global rate gate failed", "RATE_LIMITED", 429, true);
  }
}
```

**When to choose which:**

- **Pipeline inside one request / low QPS:** `IsolateTokenBucket` only.
- **Multi-tenant Worker traffic on one RD token:** `CompositeRateLimiter(local, DurableObjectRateGate)`.

---

## 8. End-to-end usage summary

```ts
const client = new RealDebridClient({
  apiToken: env.REAL_DEBRID_TOKEN,
  rateLimiter: new IsolateTokenBucket(),
});

// 1) Unrestrict
const u = await client.unrestrictLink("https://hoster.example/file");

// 2–4) Magnet pipeline with full status handling + backoff poll
const torrent = await client.downloadMagnetToCompletion(magnetUri, {
  files: "all",
  backoff: {
    initialMs: 1000,
    maxMs: 15_000,
    multiplier: 1.8,
    jitterRatio: 0.2,
    hardTimeoutMs: 20 * 60 * 1000,
  },
  onStatus: (info, decision) => {
    console.log(info.status, info.progress, decision.kind);
  },
});

// 5) List downloads
const downloads = await client.listDownloads({ limit: 50 });
```

### Status handling guarantees

- `magnet_conversion` → continue  
- `waiting_files_selection` → select files (pipeline) or error if polling after selection expected  
- `queued` / `downloading` → continue  
- `downloaded` → success  
- `error` / `virus` / `dead` → typed failure, no retry of poll success path  
- unknown status → `UNEXPECTED_STATUS` (explicit, not silent)

### Retry guarantees

- **401 / 403 / infringing-unavailable / most 4xx:** no retry  
- **429:** retry with `Retry-After` or backoff  
- **5xx / network:** retry on safe endpoints  
- **addMagnet:** not blindly retry-safe; network-only auto-retry + hash de-dupe via `addMagnetSafe`  
- **selectFiles / GET info / list downloads / list torrents:** retry-safe  

### Security guarantees

- Token only in Worker `env`  
- Browser talks to your routes only  
- Responses sanitized; errors never include the bearer secret  

---

## 9. File layout suggestion (for a real project)

```
src/
  rd/
    errors.ts        # RdApiError, classifyHttpError, RdErrorCode
    rateLimit.ts     # IsolateTokenBucket, CompositeRateLimiter, interfaces
    status.ts        # RdTorrentStatus, decideTorrentStatus, pollUntilDownloaded
    client.ts        # RealDebridClient
    types.ts
  worker.ts          # HTTP boundary, secrets, authorizeAppUser
  rd-rate-limiter-do.ts  # optional DO
```

This single module above can be split along those lines without changing behavior.

---

## 10. Notes / caveats

- Exact RD error strings for infringing content can vary; classification uses status codes plus message heuristics — adjust if RD documents a stable `error_code` field for your account tier.
- Worker **wall-clock and subrequest limits** make multi-hour torrent waits unsuitable for a single HTTP handler; return `202` + torrent id and poll `GET /api/torrents/:id`.
- `setTimeout` **within** one invocation is valid; **cross-request** timer state is not — hence lazy wall-clock refill and optional Durable Objects.
- All HTTP is `fetch` only; body encoding for POSTs is `application/x-www-form-urlencoded` as used by RD’s REST API.
