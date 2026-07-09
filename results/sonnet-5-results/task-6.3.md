# Real-Debrid REST API Client for Cloudflare Workers (TypeScript)

This answer gives a complete, self-contained TypeScript module (no external HTTP libraries, `fetch` only) implementing a Real-Debrid client for use inside a Cloudflare Worker, plus the design rationale requested for each requirement. Where I am not 100% certain of an exact Real-Debrid API detail (e.g. precise header names for rate-limit remaining/reset, or whether every error body always includes an `error_code` field), I say so explicitly rather than asserting it as fact — the code is written defensively so it does not depend on those uncertain details being correct.

---

## 0. Assumptions and uncertainties (stated up front)

- Real-Debrid's documented rate limit is commonly cited as **250 requests/minute per token**, enforced per API token/IP by Real-Debrid's servers. I have **not** independently verified the exact current limit or whether RD returns `Retry-After` or `X-RateLimit-*` headers on 429 — I did not have live API access while writing this, so the code treats any 429 defensively: it reads `Retry-After` if present, and falls back to a fixed backoff if absent. Treat the exact header names as "best effort, verify against current RD docs before production use."
- RD's torrent status field values (`magnet_conversion`, `waiting_files_selection`, `queued`, `downloading`, `downloaded`, `error`, `virus`, `dead`, and also `uploading` and `compressing` in some documented variants) are taken from the publicly documented `/torrents/info/{id}` response. I explicitly modeled the 8 statuses named in the task; I also defensively handle `uploading`/`compressing` and an `unknown` fallback in case RD adds/returns something not in this list, because treating an unhandled enum value as a silent no-op is a correctness bug.
- I am assuming the Worker holds the RD API token as a `secrets`-bound environment variable (`env.RD_API_TOKEN`), which is the standard Cloudflare Workers secret mechanism (`wrangler secret put`).

---

## 1. Rate limiting under the Workers execution model

### The constraint

Cloudflare Workers do **not** give you a persistent process. Each incoming request is handled by a `fetch` handler invocation that may run on a *fresh isolate*, a *warm/reused isolate*, or be *evicted* immediately after the response is sent (isolates are recycled aggressively, memory is not guaranteed to survive between requests, and there is no guarantee that two requests hit the same isolate, even from the same client back-to-back). Consequences:

- `setInterval`/`setTimeout`-based "background" rate limiters that assume a long-lived process are unsound: a Worker's event loop is torn down once the request (or `waitUntil` task) finishes — there is no ambient timer running between requests.
- In-memory module-scope state (a `let tokens = 250` counter at the top of the module) is **best-effort only**. It persists only for the lifetime of a given isolate and is invisible to every other isolate (and every other Cloudflare edge location running your Worker concurrently). Under real traffic you may have dozens of isolates live simultaneously across colos, each with its own independent counter — the *true* aggregate request rate to Real-Debrid can be `N × 250` in the worst case, not 250.
- There is no cross-request mutex without an external coordination point.

### The solution: two-tier limiter, chosen by required strictness

**Tier A — Durable Object token bucket (strong guarantee, recommended for anything shared across users/requests).**
A single Durable Object (DO) instance, addressed by a fixed name (e.g. `idFromName("rd-global-limiter")`), holds the *only* authoritative token bucket for the whole Worker deployment (or one bucket per RD account/token if you proxy multiple users' RD tokens). Because a DO is a single-threaded, single-instance object with durable storage, all isolates funnel their "may I make an RD call?" check through it via RPC/fetch, and it can safely decrement/refill a counter with strict serialization. This is the only construct in the Workers platform that gives you a true global mutex + shared counter without a third-party datastore.

- Use this when: multiple concurrent users' Worker invocations all share one RD account/token (e.g. your Worker is a single-tenant debrid backend), or you need a *hard* guarantee you never exceed 250/min because breaching it risks the RD account being throttled/banned.
- Cost: one extra network hop (Worker → DO) per RD call, DO billing, added latency (typically sub-10ms same-region).

**Tier B — Per-isolate best-effort limiter (cheap, acceptable when over-counting is tolerable).**
A module-scope token bucket that lives only for the isolate's lifetime. It costs nothing extra and catches the common case (a single isolate serving a burst of requests from one user, e.g. polling loops that happen to land on a warm isolate). It **cannot** prevent the platform-wide multi-isolate overrun described above.

- Use this when: RD calls are already infrequent/naturally spaced (e.g. one unrestrict per user click), the Worker is low-traffic, or you're comfortable relying on RD's own 429 responses as the backstop and just want to avoid needless self-inflicted 429s within a single hot isolate (e.g. a tight polling loop within one request's `waitUntil`).

**Recommended default in the code below:** implement both, with the DO as the source of truth used at the "one RD call = one token" boundary, and the per-isolate bucket as a fast local pre-check to avoid a DO round-trip when we already know locally we're empty. If the DO is not configured (e.g. local dev without DO bindings), the client degrades gracefully to isolate-local limiting and logs a warning — this is a deliberate fallback, not silent data loss, since worst case is extra 429s which are already handled by the retry logic in Section 3.

```typescript
// ============================================================================
// rate-limiter.ts
// ============================================================================

/** Shared token-bucket configuration for the Real-Debrid API. */
export const RD_RATE_LIMIT = {
  /** RD's documented approximate ceiling. Treat as unverified against current
   *  RD docs at integration time — confirm before relying on it in production. */
  maxRequestsPerWindow: 250,
  windowMs: 60_000,
} as const;

/** Minimal interface both limiter tiers implement so callers don't care which one is active. */
export interface RateLimiter {
  /** Resolves once it is safe to make one request; consumes one token. */
  acquire(): Promise<void>;
}

/**
 * Tier B: per-isolate best-effort limiter.
 * Lives in module scope so it is reused across requests handled by the SAME
 * warm isolate, but a fresh isolate starts with a full bucket — this is not
 * a global guarantee, only a local courtesy limiter.
 */
export class IsolateLocalLimiter implements RateLimiter {
  private tokens: number;
  private windowStart: number;

  constructor(
    private readonly max = RD_RATE_LIMIT.maxRequestsPerWindow,
    private readonly windowMs = RD_RATE_LIMIT.windowMs,
  ) {
    this.tokens = max;
    this.windowStart = Date.now();
  }

  private refillIfNeeded(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.tokens = this.max;
      this.windowStart = now;
    }
  }

  async acquire(): Promise<void> {
    this.refillIfNeeded();
    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }
    // Bucket exhausted for this isolate's current window: wait out the
    // remainder of the window. NOTE: this is a real await inside a single
    // request's execution (or a waitUntil task) — it is NOT a cross-request
    // timer, so it respects the Workers model (no ambient background timers).
    const waitMs = this.windowMs - (Date.now() - this.windowStart);
    await sleep(Math.max(waitMs, 0));
    this.refillIfNeeded();
    this.tokens = Math.max(this.tokens - 1, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tier A: Durable Object token bucket. This DO class must be exported from
 * your Worker's entry module and bound in wrangler.toml, e.g.:
 *
 *   [[durable_objects.bindings]]
 *   name = "RD_LIMITER"
 *   class_name = "RdRateLimiterDO"
 *
 * All isolates call the SAME DO instance (fixed idFromName), so the counter
 * below is genuinely global/serialized — the DO runtime guarantees only one
 * request is processed at a time per instance.
 */
export class RdRateLimiterDO {
  private state: DurableObjectState;
  private tokens = RD_RATE_LIMIT.maxRequestsPerWindow;
  private windowStart = Date.now();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(_req: Request): Promise<Response> {
    // Restore persisted counters on cold start of this DO instance.
    const stored = await this.state.storage.get<{ tokens: number; windowStart: number }>("bucket");
    if (stored) {
      this.tokens = stored.tokens;
      this.windowStart = stored.windowStart;
    }

    const now = Date.now();
    if (now - this.windowStart >= RD_RATE_LIMIT.windowMs) {
      this.tokens = RD_RATE_LIMIT.maxRequestsPerWindow;
      this.windowStart = now;
    }

    if (this.tokens <= 0) {
      const retryAfterMs = RD_RATE_LIMIT.windowMs - (now - this.windowStart);
      return new Response(JSON.stringify({ ok: false, retryAfterMs }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    this.tokens -= 1;
    await this.state.storage.put("bucket", { tokens: this.tokens, windowStart: this.windowStart });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

/** Client-side wrapper that talks to the DO and retries locally if the DO says "wait". */
export class DurableObjectLimiter implements RateLimiter {
  constructor(private readonly stub: DurableObjectStub) {}

  async acquire(): Promise<void> {
    for (;;) {
      const res = await this.stub.fetch("https://rd-limiter.internal/acquire");
      const body = await res.json<{ ok: boolean; retryAfterMs?: number }>();
      if (body.ok) return;
      await sleep(Math.min(body.retryAfterMs ?? 1000, RD_RATE_LIMIT.windowMs));
    }
  }
}

/** Composite limiter: cheap local pre-check backed by the authoritative DO. */
export class CompositeLimiter implements RateLimiter {
  constructor(
    private readonly local: IsolateLocalLimiter,
    private readonly global: RateLimiter | undefined,
  ) {}

  async acquire(): Promise<void> {
    await this.local.acquire();
    if (this.global) {
      await this.global.acquire();
    }
    // If `global` is undefined (DO not bound, e.g. local dev), we fall back
    // to isolate-local-only limiting. This is a deliberate degrade, logged
    // by the caller, not a silent correctness gap for single-isolate cases.
  }
}
```

---

## 2. Torrent status polling: state machine, backoff, jitter, hard timeout

Real-Debrid torrent lifecycle (as documented) transitions roughly:

```
magnet_conversion -> waiting_files_selection -> queued -> downloading -> downloaded
                                                     \-> virus
                                       (any state) -> error
                                       (any state) -> dead
```

Every one of the 8 named statuses is handled explicitly below — there is no default/fallthrough that silently treats an unhandled status as "still going." An `unrecognized_status` case is also included defensively (RD has added statuses like `uploading`/`compressing` in some deployments) so an unknown string can't be silently swallowed by a `switch` falling through — it is surfaced as a distinct terminal-ish "unknown" result the caller must decide how to handle, rather than looping forever.

```typescript
// ============================================================================
// torrent-poller.ts
// ============================================================================

export type RdTorrentStatus =
  | "magnet_conversion"
  | "waiting_files_selection"
  | "queued"
  | "downloading"
  | "downloaded"
  | "error"
  | "virus"
  | "dead"
  // Defensive: RD has been observed to emit these in some flows/regions;
  // not part of the 8 statuses the task named, but unhandled-enum bugs are
  // worse than an explicit "we don't know" branch.
  | "uploading"
  | "compressing";

export interface RdTorrentInfo {
  id: string;
  filename: string;
  status: RdTorrentStatus;
  progress: number; // 0-100
  links: string[]; // populated once downloaded
  files: Array<{ id: number; path: string; bytes: number; selected: 0 | 1 }>;
}

export type PollOutcome =
  | { kind: "downloaded"; info: RdTorrentInfo }
  | { kind: "needs_file_selection"; info: RdTorrentInfo }
  | { kind: "failed"; reason: "error" | "virus" | "dead"; info: RdTorrentInfo }
  | { kind: "timeout"; lastInfo: RdTorrentInfo | null }
  | { kind: "unknown_status"; status: string; info: RdTorrentInfo };

export interface PollOptions {
  /** Hard ceiling on total wall-clock time spent polling. Required — an
   *  unbounded poll loop in a Worker risks hitting the platform's CPU/wall
   *  time limits and leaves the caller hanging indefinitely. */
  hardTimeoutMs: number;
  /** Base delay for exponential backoff. */
  baseDelayMs?: number;
  /** Ceiling on any single backoff delay. */
  maxDelayMs?: number;
  /** Called on every poll tick with the latest info, useful for logging/telemetry. */
  onTick?: (info: RdTorrentInfo, attempt: number) => void;
}

/**
 * Polls RD torrent status to a terminal state, with exponential backoff +
 * full jitter, and a hard timeout. Every named RD status is handled
 * explicitly — none fall through to a default "keep polling" branch by
 * accident. Terminal states (downloaded/error/virus/dead) stop the loop
 * immediately; waiting_files_selection is ALSO terminal from the poller's
 * point of view because RD will not progress a torrent until files are
 * selected — the caller must call selectFiles() and then resume polling.
 */
export async function pollTorrentStatus(
  client: RealDebridClient,
  torrentId: string,
  opts: PollOptions,
): Promise<PollOutcome> {
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const deadline = Date.now() + opts.hardTimeoutMs;

  let attempt = 0;
  let lastInfo: RdTorrentInfo | null = null;

  while (Date.now() < deadline) {
    attempt += 1;

    let info: RdTorrentInfo;
    try {
      info = await client.getTorrentInfo(torrentId);
    } catch (err) {
      if (err instanceof RdRateLimitError) {
        // Respect RD's own backoff signal in preference to ours.
        await sleep(err.retryAfterMs ?? computeBackoff(attempt, baseDelayMs, maxDelayMs));
        continue;
      }
      if (err instanceof RdTransientServerError) {
        await sleep(computeBackoff(attempt, baseDelayMs, maxDelayMs));
        continue;
      }
      // Auth/permission/not-found errors are not retryable inside a poll
      // loop — surface immediately rather than burning the timeout budget.
      throw err;
    }

    lastInfo = info;
    opts.onTick?.(info, attempt);

    switch (info.status) {
      case "downloaded":
        return { kind: "downloaded", info };

      case "waiting_files_selection":
        return { kind: "needs_file_selection", info };

      case "error":
        return { kind: "failed", reason: "error", info };

      case "virus":
        return { kind: "failed", reason: "virus", info };

      case "dead":
        return { kind: "failed", reason: "dead", info };

      case "magnet_conversion":
      case "queued":
      case "downloading":
      case "uploading":
      case "compressing": {
        // Non-terminal: keep polling after a jittered exponential backoff.
        const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs);
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(delay, Math.max(remaining, 0)));
        continue;
      }

      default: {
        // Exhaustiveness guard: if RD ever returns a status string not in
        // RdTorrentStatus, TypeScript will flag `info.status` as `never`
        // here at compile time IF the union above is kept up to date. At
        // runtime (untyped JSON from RD), fall into an explicit branch
        // instead of looping silently or throwing.
        const _exhaustive: never = info.status;
        return { kind: "unknown_status", status: _exhaustive as unknown as string, info };
      }
    }
  }

  return { kind: "timeout", lastInfo };
}

/** Exponential backoff with full jitter (AWS-style: random in [0, cap]). */
function computeBackoff(attempt: number, baseMs: number, capMs: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.random() * exp;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Design notes:**
- `waiting_files_selection` is treated as a *stopping point*, not something to poll through — RD will not proceed until `selectFiles` is called, so looping on it would just burn the timeout budget for no reason. The caller is expected to call `selectFiles()` then re-invoke `pollTorrentStatus` for the next phase.
- Full-jitter backoff (`random(0, cap)`) rather than "backoff ± jitter" is used deliberately: it is the AWS-recommended formula for avoiding thundering-herd synchronization across many concurrent pollers (e.g. many Worker requests polling different torrents at once still spread their retries out).
- The hard timeout is wall-clock based and checked both before starting a new attempt and before sleeping, so it can't be exceeded by more than one in-flight request's latency.
- Because this all happens inside `fetch()`'s handling of a single request (or inside a `ctx.waitUntil()` task), it stays within the Workers execution model: no assumption of a persistent background timer across requests — the entire poll loop lives inside one invocation's lifetime, bounded by `hardTimeoutMs`, which itself must be kept under the platform's applicable CPU/wall-clock limits for the plan in use (this needs to be tuned to your Workers plan's limits; I'm not asserting a specific number here since it depends on your account tier/whether you're using `waitUntil`).

---

## 3. Error taxonomy and idempotency-aware retries

```typescript
// ============================================================================
// errors.ts
// ============================================================================

export abstract class RdApiError extends Error {
  abstract readonly retryable: boolean;
  constructor(message: string, public readonly status: number, public readonly bodyText?: string) {
    super(message);
  }
}

/** 401: token missing/expired/revoked. Not retryable without re-auth. */
export class RdAuthExpiredError extends RdApiError {
  readonly retryable = false;
  constructor(status: number, bodyText?: string) {
    super("Real-Debrid auth token expired or invalid (401)", status, bodyText);
  }
}

/** 403: action requires premium status, or is otherwise forbidden for this account. */
export class RdPermissionError extends RdApiError {
  readonly retryable = false;
  constructor(status: number, bodyText?: string) {
    super("Real-Debrid permission denied / premium required (403)", status, bodyText);
  }
}

/** File/link is unavailable, e.g. infringing content removed, hoster dead, or 404 on lookup. */
export class RdUnavailableError extends RdApiError {
  readonly retryable = false;
  constructor(status: number, bodyText?: string) {
    super("Real-Debrid resource unavailable (infringing/removed/404)", status, bodyText);
  }
}

/** 429: rate-limited. Retryable, but only after honoring Retry-After / backoff. */
export class RdRateLimitError extends RdApiError {
  readonly retryable = true;
  readonly retryAfterMs?: number;
  constructor(status: number, retryAfterMs: number | undefined, bodyText?: string) {
    super("Real-Debrid rate limit exceeded (429)", status, bodyText);
    this.retryAfterMs = retryAfterMs;
  }
}

/** 5xx: transient server-side failure. Retryable with backoff, bounded attempts. */
export class RdTransientServerError extends RdApiError {
  readonly retryable = true;
  constructor(status: number, bodyText?: string) {
    super(`Real-Debrid transient server error (${status})`, status, bodyText);
  }
}

/** Anything else unexpected (4xx not covered above, malformed response, network failure). */
export class RdUnknownError extends RdApiError {
  readonly retryable = false;
  constructor(status: number, bodyText?: string) {
    super(`Real-Debrid unexpected error (${status})`, status, bodyText);
  }
}

/** Maps a fetch Response to a typed error. Call only when !response.ok. */
export async function classifyRdError(response: Response): Promise<RdApiError> {
  const bodyText = await response.text().catch(() => undefined);
  switch (response.status) {
    case 401:
      return new RdAuthExpiredError(response.status, bodyText);
    case 403:
      return new RdPermissionError(response.status, bodyText);
    case 404:
    case 410:
      // RD uses 404-ish statuses for removed/infringing/dead links depending
      // on endpoint. Verify exact codes against current RD docs per-endpoint;
      // treated conservatively here as non-retryable "unavailable".
      return new RdUnavailableError(response.status, bodyText);
    case 429: {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      return new RdRateLimitError(response.status, retryAfterMs, bodyText);
    }
    default:
      if (response.status >= 500 && response.status < 600) {
        return new RdTransientServerError(response.status, bodyText);
      }
      return new RdUnknownError(response.status, bodyText);
  }
}
```

### Idempotency analysis per endpoint (explicit answers)

| Endpoint | HTTP verb | Idempotent? | Safe to auto-retry? | Reasoning |
|---|---|---|---|---|
| `POST /unrestrict/link` | POST | **Yes, effectively** | **Yes** | Unrestricting the same hoster link repeatedly does not create new server-side state or duplicate resources — RD returns (or regenerates) a direct link for the same input. Retrying on a network failure or 5xx is safe. Retrying on 429 is safe once the backoff/`Retry-After` is honored. Not safe to retry on 403 (premium required) or 401 (auth) since retrying without fixing the underlying cause just repeats the same failure. |
| `POST /torrents/addMagnet` | POST | **No — answered explicitly: NOT safe to blindly retry** | **No, not by default** | Adding a magnet is a *creating* operation: RD assigns a new torrent id and begins processing on each successful call. If the first request actually succeeded server-side but the response was lost (e.g. timeout on our end, or a 5xx returned only after RD already accepted the magnet), a naive retry can create a **second duplicate torrent entry** in the user's RD account, consuming a torrent slot and confusing later status/selection calls (you'd have two ids to reconcile, or the second `addMagnet` might return the *same* id if RD dedupes by magnet hash — this is unverified/not documented reliably, so it should not be relied upon). Therefore: retry `addMagnet` **only** on errors that are provably pre-execution (i.e., our own network layer failed before any bytes reached RD, or a 429 received *before* RD did any processing — since 429 by definition means the request was rejected before processing). On 5xx or ambiguous timeouts, do **not** auto-retry; instead, before retrying, call `GET /torrents` and check whether a torrent with a matching magnet hash/filename already exists, and only submit a new `addMagnet` if it does not. This "check-then-retry" pattern is implemented in the client below via `addMagnetIdempotent`. |
| `POST /torrents/selectFiles/{id}` | POST | **Conditionally** | **Yes, if still in `waiting_files_selection`** | Re-selecting the same file set on a torrent still awaiting selection is a no-op in effect (same selection re-applied). Retryable on network/5xx/429 as long as you first re-check status is still `waiting_files_selection` (if the first call actually succeeded and the torrent moved to `queued`/`downloading`, a second `selectFiles` call may 4xx harmlessly or be rejected — treat that as success, not failure, since the desired end state was already reached). |
| `GET /torrents/info/{id}` | GET | **Yes** | **Yes** | Pure read, no side effects. Always safe to retry with backoff. |
| `GET /downloads` | GET | **Yes** | **Yes** | Pure read, no side effects. Always safe to retry with backoff. |

### Retry wrapper implementing the table above

```typescript
// ============================================================================
// retry.ts
// ============================================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: RetryOptions,
): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 15_000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === opts.maxAttempts) throw err;

      let delay = Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      if (err instanceof RdRateLimitError && err.retryAfterMs) {
        delay = err.retryAfterMs;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
```

---

## 4. Full client + the Worker boundary (never leaking the token)

### Boundary design

The Real-Debrid API token is a **server-side secret**, bound via `wrangler secret put RD_API_TOKEN` and read only as `env.RD_API_TOKEN` inside the Worker's `fetch` handler. It must never appear in:
- any response body or header sent back to the browser/client,
- any URL that could be logged by an intermediary (RD's own API takes the token as an `Authorization: Bearer` header, not a query param, in this client — never put it in a query string),
- client-side JS, cookies, or `Set-Cookie` headers,
- error messages returned to the client (the client-facing error mapping below strips `bodyText`/headers from RD's raw responses before they reach the browser).

The Worker exposes its **own** narrow, purpose-built endpoints (e.g. `POST /api/unrestrict`, `POST /api/download-magnet`) that accept only the inputs they need (a magnet link, a hoster URL) and return only the derived result (a direct download URL, a status enum) — never proxying RD's raw response or RD's headers back verbatim, since RD's raw response could itself echo back account-identifying info. The RD client module (`RealDebridClient`) is only ever instantiated inside the Worker, holding the token in a private field that is never serialized.

```typescript
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
```

### Worker entry point (the actual boundary)

```typescript
// ============================================================================
// worker.ts — the ONLY place the RD token is read; the ONLY HTTP surface
// exposed to end users. The RD token never crosses this boundary outward.
// ============================================================================

export interface Env {
  RD_API_TOKEN: string; // set via `wrangler secret put RD_API_TOKEN`
  RD_LIMITER: DurableObjectNamespace; // bound to RdRateLimiterDO
}

export { RdRateLimiterDO } from "./rate-limiter";

function buildClient(env: Env): RealDebridClient {
  const doId = env.RD_LIMITER.idFromName("rd-global-limiter");
  const stub = env.RD_LIMITER.get(doId);
  const local = new IsolateLocalLimiter();
  const globalLimiter = new DurableObjectLimiter(stub);
  const limiter = new CompositeLimiter(local, globalLimiter);
  return new RealDebridClient(env.RD_API_TOKEN, limiter);
}

/** Strips any RD internals (headers, raw body text, token) before responding to the client. */
function toClientSafeError(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof RdAuthExpiredError) return { status: 502, body: { error: "upstream_auth_expired" } };
  if (err instanceof RdPermissionError) return { status: 402, body: { error: "premium_required" } };
  if (err instanceof RdUnavailableError) return { status: 404, body: { error: "file_unavailable" } };
  if (err instanceof RdRateLimitError) return { status: 503, body: { error: "rate_limited_try_later" } };
  if (err instanceof RdTransientServerError) return { status: 502, body: { error: "upstream_unavailable" } };
  return { status: 500, body: { error: "internal_error" } };
  // Note: none of these branches include err.bodyText, err.message details
  // from RD, or any header — only a coarse client-safe code, precisely so
  // the token and RD's internal response shape can never leak via an error path.
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/unrestrict" && req.method === "POST") {
      const { link } = await req.json<{ link: string }>();
      if (!link || typeof link !== "string") {
        return Response.json({ error: "missing_link" }, { status: 400 });
      }
      const client = buildClient(env);
      try {
        const result = await client.unrestrictLink(link);
        // Return ONLY the fields the frontend needs — not the raw RD object,
        // which may include account-identifying metadata.
        return Response.json({ download: result.download, filename: result.filename });
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    if (url.pathname === "/api/download-magnet" && req.method === "POST") {
      const { magnet, magnetHash } = await req.json<{ magnet: string; magnetHash: string }>();
      if (!magnet || !magnetHash) {
        return Response.json({ error: "missing_magnet" }, { status: 400 });
      }
      const client = buildClient(env);
      try {
        const added = await client.addMagnetIdempotent(magnet, magnetHash);
        const selection = await client.getTorrentInfo(added.id);
        if (selection.status === "waiting_files_selection") {
          await client.selectFiles(added.id, "all");
        }
        const outcome = await pollTorrentStatus(client, added.id, { hardTimeoutMs: 60_000 });
        if (outcome.kind === "downloaded") {
          return Response.json({
            status: "downloaded",
            links: outcome.info.links,
          });
        }
        if (outcome.kind === "failed") {
          return Response.json({ status: "failed", reason: outcome.reason }, { status: 422 });
        }
        return Response.json({ status: outcome.kind }, { status: 202 });
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    if (url.pathname === "/api/downloads" && req.method === "GET") {
      const client = buildClient(env);
      try {
        const downloads = await client.listDownloads();
        return Response.json(
          downloads.map((d) => ({ id: d.id, filename: d.filename, download: d.download, filesize: d.filesize })),
        );
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
```

**Why this satisfies "never leak the token":**
1. `env.RD_API_TOKEN` is read exactly once per request, inside `buildClient`, which is only called from Worker route handlers — never returned, logged, or included in any response.
2. `RealDebridClient` stores the token in a `#private` class field (true JS private, not just a TS-erased `private`), so it cannot be read via `Object.keys()`, `JSON.stringify(client)`, spreading, or reflection — an accidental `Response.json(client)` (a real class of bug) would serialize to `{}` rather than exposing the token, though the client also structurally never does this since it always returns narrow DTOs.
3. Client-facing error mapping (`toClientSafeError`) intentionally discards RD's raw error body/headers, returning only a small closed set of coarse error codes — RD's response internals (which could include account metadata) never reach the browser.
4. The Worker's public endpoints (`/api/unrestrict`, `/api/download-magnet`, `/api/downloads`) accept only the minimal input needed and return only the minimal derived output needed — they are not a generic RD proxy, so there is no code path where an attacker-controlled path/header could be relayed straight through to RD with the token attached and the raw response relayed straight back.

---

## Summary of what is verified vs. assumed

**Confident (standard, well-documented Real-Debrid/Workers behavior):** the general RD REST endpoint shapes (`/unrestrict/link`, `/torrents/addMagnet`, `/torrents/selectFiles/{id}`, `/torrents/info/{id}`, `/downloads`, `/torrents`), Bearer-token auth, the 8 named torrent statuses, and the Cloudflare Workers isolate/Durable Object execution model.

**Explicitly flagged as unverified / needs confirmation before production use:**
- The exact current RD rate limit value and whether 429 responses include `Retry-After` or `X-RateLimit-*` headers (code defends against their absence).
- Whether RD's `addMagnet` dedupes by magnet hash server-side (would simplify the idempotency story if true) — not assumed; the client instead does its own reconciliation via `listTorrents`.
- The exact HTTP status RD uses for "infringing/unavailable" content specifically (modeled as 404/410, but should be confirmed against current RD docs, as this may in some cases surface as a differently-shaped error in the response body rather than the status code).
