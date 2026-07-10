# TypeScript Real-Debrid Client for Cloudflare Workers

Below is a single Worker-safe TypeScript module. It keeps the Real-Debrid API token on the Worker side, provides the requested API operations, implements explicit torrent-status handling, and includes both a per-isolate best-effort rate limiter and a Durable Object based limiter for production-wide enforcement.

```ts
/* realdebrid.ts
 * Real-Debrid REST API client for Cloudflare Workers.
 * Requires the API token to be stored as a Worker secret, never in browser code.
 */

export type RDTorrentStatus =
  | "magnet_conversion"
  | "waiting_files_selection"
  | "queued"
  | "downloading"
  | "downloaded"
  | "error"
  | "virus"
  | "dead";

export const RD_TORRENT_TRANSITIONS: Record<RDTorrentStatus, readonly RDTorrentStatus[]> = {
  magnet_conversion: [
    "waiting_files_selection",
    "queued",
    "downloading",
    "downloaded",
    "error",
    "virus",
    "dead",
  ],
  waiting_files_selection: ["queued", "downloading", "downloaded", "error", "virus", "dead"],
  queued: ["downloading", "downloaded", "error", "virus", "dead"],
  downloading: ["downloaded", "error", "virus", "dead"],
  downloaded: [],
  error: [],
  virus: [],
  dead: [],
};

export type RDFileSelection = "all" | readonly number[];

export interface RDUnrestrictedLink {
  id?: string;
  filename?: string;
  mimeType?: string;
  filesize?: number;
  link?: string;
  host?: string;
  chunks?: number;
  crc?: number;
  download: string;
  streamable?: number;
  [key: string]: unknown;
}

export interface RDAddMagnetResult {
  id: string;
  uri?: string;
  [key: string]: unknown;
}

export interface RDTorrentFile {
  id: number;
  path: string;
  bytes: number;
  selected: 0 | 1;
  [key: string]: unknown;
}

export interface RDTorrentInfo {
  id: string;
  filename?: string;
  status: string;
  files?: RDTorrentFile[];
  links?: string[];
  progress?: number;
  speed?: number;
  seeders?: number;
  bytes?: number;
  original_bytes?: number;
  added?: string;
  ended?: string;
  [key: string]: unknown;
}

export interface RDDownloadedTorrentInfo extends RDTorrentInfo {
  status: "downloaded";
  links: string[];
}

export interface RDDownloadItem {
  id: string;
  filename?: string;
  mimeType?: string;
  filesize?: number;
  link?: string;
  host?: string;
  download?: string;
  generated?: string;
  [key: string]: unknown;
}

export interface RDRequestOptions {
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface RDUnrestrictOptions extends RDRequestOptions {
  password?: string;
}

export interface RDListDownloadsOptions extends RDRequestOptions {
  page?: number;
  offset?: number;
  limit?: number;
}

export interface RDPollOptions extends RDRequestOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onWaitingFilesSelection?:
    | "throw"
    | "selectAll"
    | RDFileSelection
    | ((info: RDTorrentInfo) => RDFileSelection | Promise<RDFileSelection>);
}

export interface RealDebridClientOptions {
  apiToken: string;
  limiter?: RateLimiter;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

export interface RateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}

interface RetryPolicy {
  operation: string;
  retryOn429: boolean;
  retryOn5xx: boolean;
  retryOnNetworkError: boolean;
  maxRetries?: number;
}

interface RDErrorContext {
  method?: string;
  endpoint?: string;
  status?: number;
  rdError?: string;
  rdErrorCode?: string | number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class RDAPIError extends Error {
  readonly method?: string;
  readonly endpoint?: string;
  readonly status?: number;
  readonly rdError?: string;
  readonly rdErrorCode?: string | number;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;

  constructor(message: string, context: RDErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.method = context.method;
    this.endpoint = context.endpoint;
    this.status = context.status;
    this.rdError = context.rdError;
    this.rdErrorCode = context.rdErrorCode;
    this.retryAfterMs = context.retryAfterMs;
    this.cause = context.cause;
  }
}

export class RDAuthExpiredError extends RDAPIError {}
export class RDPremiumRequiredError extends RDAPIError {}
export class RDUnavailableFileError extends RDAPIError {}
export class RDRateLimitedError extends RDAPIError {}
export class RDTransientUpstreamError extends RDAPIError {}
export class RDNetworkError extends RDAPIError {}
export class RDWaitingFilesSelectionError extends RDAPIError {
  readonly torrent: RDTorrentInfo;

  constructor(torrent: RDTorrentInfo) {
    super("Real-Debrid torrent is waiting for file selection", {
      endpoint: `/torrents/info/${torrent.id}`,
    });
    this.torrent = torrent;
  }
}
export class RDTorrentTerminalError extends RDAPIError {
  readonly torrent: RDTorrentInfo;
  readonly torrentStatus: RDTorrentStatus;

  constructor(torrent: RDTorrentInfo, status: RDTorrentStatus) {
    super(`Real-Debrid torrent reached terminal status: ${status}`, {
      endpoint: `/torrents/info/${torrent.id}`,
    });
    this.torrent = torrent;
    this.torrentStatus = status;
  }
}
export class RDUnexpectedTorrentStatusError extends RDAPIError {
  readonly torrent: RDTorrentInfo;

  constructor(torrent: RDTorrentInfo) {
    super(`Unexpected Real-Debrid torrent status: ${String(torrent.status)}`, {
      endpoint: `/torrents/info/${torrent.id}`,
    });
    this.torrent = torrent;
  }
}
export class RDPollTimeoutError extends RDAPIError {
  readonly torrentId: string;

  constructor(torrentId: string, timeoutMs: number) {
    super(`Timed out waiting for Real-Debrid torrent ${torrentId} after ${timeoutMs}ms`, {
      endpoint: `/torrents/info/${torrentId}`,
    });
    this.torrentId = torrentId;
  }
}

export class NoopRateLimiter implements RateLimiter {
  async acquire(): Promise<void> {
    return;
  }
}

/*
 * Best-effort limiter for one Worker isolate.
 *
 * Cloudflare Workers do not give you a durable process that runs forever.
 * An isolate can be evicted, and multiple isolates can handle requests at the
 * same time. Therefore this limiter does not use setInterval. It refills
 * lazily on each acquire() using Date.now(), and only coordinates calls that
 * happen to share the same isolate. Use it for low traffic, one-user tools, or
 * as a local smoothing layer.
 */
export class InMemoryTokenBucketLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private updatedAtMs: number;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: { capacity?: number; requestsPerMinute?: number } = {}) {
    this.capacity = options.capacity ?? 250;
    this.refillPerMs = (options.requestsPerMinute ?? 240) / 60_000;
    this.tokens = this.capacity;
    this.updatedAtMs = Date.now();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    const run = this.chain.catch(() => undefined).then(() => this.acquireUnqueued(signal));
    this.chain = run.catch(() => undefined);
    await run;
  }

  private async acquireUnqueued(signal?: AbortSignal): Promise<void> {
    for (;;) {
      throwIfAborted(signal);
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const missing = 1 - this.tokens;
      const waitMs = Math.max(10, Math.ceil(missing / this.refillPerMs));
      await sleep(waitMs, signal);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.updatedAtMs);
    this.updatedAtMs = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
  }
}

/*
 * Production-wide limiter option.
 *
 * Bind this class as a Durable Object and use DurableObjectRateLimiterClient
 * in the Worker. Durable Objects serialize requests for a chosen object ID, so
 * a single named object can enforce one account-wide token bucket across
 * isolates and regions. This also refills lazily; it does not depend on a
 * background setInterval surviving between requests.
 */
export class RDRateLimiterDurableObject {
  private tokens: number | undefined;
  private updatedAtMs: number | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/acquire") {
      return new Response("Not found", { status: 404 });
    }

    const capacity = intParam(url, "capacity", 250);
    const requestsPerMinute = intParam(url, "requestsPerMinute", 240);

    const run = this.chain
      .catch(() => undefined)
      .then(() => this.acquire(capacity, requestsPerMinute, request.signal));
    this.chain = run.catch(() => undefined);
    await run;

    return new Response(null, { status: 204 });
  }

  private async acquire(
    capacity: number,
    requestsPerMinute: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.hydrate(capacity);
    const refillPerMs = requestsPerMinute / 60_000;

    for (;;) {
      throwIfAborted(signal);
      const now = Date.now();
      const elapsedMs = Math.max(0, now - (this.updatedAtMs ?? now));
      this.updatedAtMs = now;
      this.tokens = Math.min(capacity, (this.tokens ?? capacity) + elapsedMs * refillPerMs);

      if (this.tokens >= 1) {
        this.tokens -= 1;
        await this.state.storage.put("bucket", {
          tokens: this.tokens,
          updatedAtMs: this.updatedAtMs,
        });
        return;
      }

      const missing = 1 - this.tokens;
      const waitMs = Math.max(10, Math.ceil(missing / refillPerMs));
      await sleep(waitMs, signal);
    }
  }

  private async hydrate(capacity: number): Promise<void> {
    if (this.tokens !== undefined && this.updatedAtMs !== undefined) return;

    const saved = await this.state.storage.get<{ tokens: number; updatedAtMs: number }>("bucket");
    this.tokens = typeof saved?.tokens === "number" ? saved.tokens : capacity;
    this.updatedAtMs = typeof saved?.updatedAtMs === "number" ? saved.updatedAtMs : Date.now();
  }
}

export class DurableObjectRateLimiterClient implements RateLimiter {
  constructor(
    private readonly stub: DurableObjectStub,
    private readonly options: { capacity?: number; requestsPerMinute?: number } = {},
  ) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    const url = new URL("https://rd-rate-limiter/acquire");
    url.searchParams.set("capacity", String(this.options.capacity ?? 250));
    url.searchParams.set("requestsPerMinute", String(this.options.requestsPerMinute ?? 240));

    const response = await this.stub.fetch(url.toString(), { method: "POST", signal });
    if (!response.ok) {
      throw new RDAPIError("Rate limiter Durable Object failed", { status: response.status });
    }
  }
}

export class RealDebridClient {
  private readonly apiToken: string;
  private readonly limiter: RateLimiter;
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: RealDebridClientOptions) {
    if (!options.apiToken) throw new TypeError("Real-Debrid API token is required");
    this.apiToken = options.apiToken;
    this.limiter = options.limiter ?? new NoopRateLimiter();
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.real-debrid.com/rest/1.0");
  }

  async unrestrictLink(link: string, options: RDUnrestrictOptions = {}): Promise<RDUnrestrictedLink> {
    return this.request<RDUnrestrictedLink>(
      "/unrestrict/link",
      {
        method: "POST",
        body: formBody({ link, password: options.password }),
      },
      {
        operation: "unrestrictLink",
        retryOn429: true,
        retryOn5xx: false,
        retryOnNetworkError: false,
        maxRetries: options.maxRetries,
      },
      options.signal,
    );
  }

  async addMagnet(magnet: string, options: RDRequestOptions = {}): Promise<RDAddMagnetResult> {
    return this.request<RDAddMagnetResult>(
      "/torrents/addMagnet",
      {
        method: "POST",
        body: formBody({ magnet }),
      },
      {
        operation: "addMagnet",
        retryOn429: true,
        retryOn5xx: false,
        retryOnNetworkError: false,
        maxRetries: options.maxRetries,
      },
      options.signal,
    );
  }

  async selectFiles(
    torrentId: string,
    files: RDFileSelection,
    options: RDRequestOptions = {},
  ): Promise<void> {
    const fileValue = files === "all" ? "all" : files.join(",");
    if (!fileValue) throw new TypeError("selectFiles requires 'all' or at least one file id");

    try {
      await this.request<unknown>(
        `/torrents/selectFiles/${encodeURIComponent(torrentId)}`,
        {
          method: "POST",
          body: formBody({ files: fileValue }),
        },
        {
          operation: "selectFiles",
          retryOn429: true,
          retryOn5xx: true,
          retryOnNetworkError: true,
          maxRetries: options.maxRetries,
        },
        options.signal,
      );
    } catch (error) {
      // Repeating the same file selection is intended to be idempotent from the
      // caller's point of view. If RD says the action is already done, treat it
      // as success for retry/recovery paths.
      if (error instanceof RDAPIError && /already\s+done/i.test(error.rdError ?? error.message)) return;
      throw error;
    }
  }

  async torrentInfo(torrentId: string, options: RDRequestOptions = {}): Promise<RDTorrentInfo> {
    return this.request<RDTorrentInfo>(
      `/torrents/info/${encodeURIComponent(torrentId)}`,
      { method: "GET" },
      {
        operation: "torrentInfo",
        retryOn429: true,
        retryOn5xx: true,
        retryOnNetworkError: true,
        maxRetries: options.maxRetries,
      },
      options.signal,
    );
  }

  async pollTorrentUntilDownloaded(
    torrentId: string,
    options: RDPollOptions = {},
  ): Promise<RDDownloadedTorrentInfo> {
    const timeoutMs = options.timeoutMs ?? 20 * 60_000;
    const initialDelayMs = options.initialDelayMs ?? 1_500;
    const maxDelayMs = options.maxDelayMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    for (;;) {
      throwIfAborted(options.signal);
      if (Date.now() >= deadline) throw new RDPollTimeoutError(torrentId, timeoutMs);

      const torrent = await this.torrentInfo(torrentId, { signal: options.signal });
      const status = normalizeTorrentStatus(torrent);

      switch (status) {
        case "magnet_conversion": {
          // RD is still resolving metadata from the magnet. No file selection is possible yet.
          break;
        }
        case "waiting_files_selection": {
          const selection = await resolveWaitingFilesSelection(options.onWaitingFilesSelection, torrent);
          if (selection === "throw") throw new RDWaitingFilesSelectionError(torrent);
          await this.selectFiles(torrentId, selection, { signal: options.signal });
          attempt = 0;
          break;
        }
        case "queued": {
          // Accepted by RD, waiting for a download slot.
          break;
        }
        case "downloading": {
          // Active transfer to RD. Keep polling until terminal.
          break;
        }
        case "downloaded": {
          return {
            ...torrent,
            status: "downloaded",
            links: Array.isArray(torrent.links) ? torrent.links : [],
          };
        }
        case "error": {
          throw new RDTorrentTerminalError(torrent, "error");
        }
        case "virus": {
          throw new RDUnavailableFileError("Real-Debrid rejected the torrent as a virus", {
            endpoint: `/torrents/info/${torrentId}`,
            rdError: "virus",
          });
        }
        case "dead": {
          throw new RDUnavailableFileError("Real-Debrid marked the torrent as dead or unavailable", {
            endpoint: `/torrents/info/${torrentId}`,
            rdError: "dead",
          });
        }
        default: {
          assertNever(status);
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new RDPollTimeoutError(torrentId, timeoutMs);
      const delayMs = Math.min(remainingMs, backoffWithJitter(attempt++, initialDelayMs, maxDelayMs));
      await sleep(delayMs, options.signal);
    }
  }

  async addMagnetSelectFilesAndWait(
    magnet: string,
    files: RDFileSelection,
    options: RDPollOptions = {},
  ): Promise<{ added: RDAddMagnetResult; torrent: RDDownloadedTorrentInfo }> {
    const added = await this.addMagnet(magnet, { signal: options.signal, maxRetries: options.maxRetries });
    const torrent = await this.pollTorrentUntilDownloaded(added.id, {
      ...options,
      onWaitingFilesSelection: files,
    });
    return { added, torrent };
  }

  async listDownloads(options: RDListDownloadsOptions = {}): Promise<RDDownloadItem[]> {
    const query = new URLSearchParams();
    if (options.page !== undefined) query.set("page", String(options.page));
    if (options.offset !== undefined) query.set("offset", String(options.offset));
    if (options.limit !== undefined) query.set("limit", String(options.limit));

    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<RDDownloadItem[]>(
      `/downloads${suffix}`,
      { method: "GET" },
      {
        operation: "listDownloads",
        retryOn429: true,
        retryOn5xx: true,
        retryOnNetworkError: true,
        maxRetries: options.maxRetries,
      },
      options.signal,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    policy: RetryPolicy,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetries = policy.maxRetries ?? 3;
    let attempt = 0;

    for (;;) {
      throwIfAborted(signal);
      await this.limiter.acquire(signal);

      const url = new URL(path.replace(/^\//, ""), this.baseUrl);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.apiToken}`);
      headers.set("Accept", "application/json");
      if (init.body instanceof URLSearchParams) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
      }

      let response: Response;
      try {
        response = await this.fetcher(url.toString(), {
          ...init,
          headers,
          signal,
        });
      } catch (cause) {
        const error = new RDNetworkError("Network error while calling Real-Debrid", {
          method: init.method,
          endpoint: path,
          cause,
        });
        const delayMs = retryDelayMs(error, policy, attempt, maxRetries);
        if (delayMs === undefined) throw error;
        await sleep(delayMs, signal);
        attempt += 1;
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const body = await parseBody(response);
        return body as T;
      }

      const body = await parseBody(response);
      const error = classifyResponseError(response, body, init.method ?? "GET", path);
      const delayMs = retryDelayMs(error, policy, attempt, maxRetries);
      if (delayMs === undefined) throw error;
      await sleep(delayMs, signal);
      attempt += 1;
    }
  }
}

function classifyResponseError(response: Response, body: unknown, method: string, endpoint: string): RDAPIError {
  const rdError = extractErrorMessage(body);
  const rdErrorCode = extractErrorCode(body);
  const status = response.status;
  const context: RDErrorContext = { method, endpoint, status, rdError, rdErrorCode };

  if (looksLikeUnavailableFile(rdError, rdErrorCode)) {
    return new RDUnavailableFileError(rdError ?? "Real-Debrid file is infringing or unavailable", context);
  }

  if (status === 401) {
    return new RDAuthExpiredError("Real-Debrid authentication expired or token is invalid", context);
  }

  if (status === 403) {
    return new RDPremiumRequiredError("Real-Debrid permission denied or premium account required", context);
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    return new RDRateLimitedError("Real-Debrid rate limit exceeded", { ...context, retryAfterMs });
  }

  if (status >= 500 && status <= 599) {
    return new RDTransientUpstreamError("Transient Real-Debrid upstream error", context);
  }

  return new RDAPIError(rdError ?? `Real-Debrid request failed with status ${status}`, context);
}

function retryDelayMs(
  error: RDAPIError,
  policy: RetryPolicy,
  attempt: number,
  maxRetries: number,
): number | undefined {
  if (attempt >= maxRetries) return undefined;

  if (error instanceof RDRateLimitedError && policy.retryOn429) {
    return error.retryAfterMs ?? backoffWithJitter(attempt, 1_000, 30_000);
  }

  if (error instanceof RDTransientUpstreamError && policy.retryOn5xx) {
    return backoffWithJitter(attempt, 500, 10_000);
  }

  if (error instanceof RDNetworkError && policy.retryOnNetworkError) {
    return backoffWithJitter(attempt, 500, 10_000);
  }

  return undefined;
}

function normalizeTorrentStatus(torrent: RDTorrentInfo): RDTorrentStatus {
  switch (torrent.status) {
    case "magnet_conversion":
      return "magnet_conversion";
    case "waiting_files_selection":
      return "waiting_files_selection";
    case "queued":
      return "queued";
    case "downloading":
      return "downloading";
    case "downloaded":
      return "downloaded";
    case "error":
      return "error";
    case "virus":
      return "virus";
    case "dead":
      return "dead";
    default:
      throw new RDUnexpectedTorrentStatusError(torrent);
  }
}

async function resolveWaitingFilesSelection(
  strategy: RDPollOptions["onWaitingFilesSelection"],
  torrent: RDTorrentInfo,
): Promise<RDFileSelection | "throw"> {
  if (strategy === undefined || strategy === "throw") return "throw";
  if (strategy === "selectAll") return "all";
  if (typeof strategy === "function") return strategy(torrent);
  return strategy;
}

function formBody(fields: Record<string, string | number | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 500);
  if (!isRecord(body)) return undefined;
  const candidates = [body.error, body.message, body.error_description];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return undefined;
}

function extractErrorCode(body: unknown): string | number | undefined {
  if (!isRecord(body)) return undefined;
  const value = body.error_code ?? body.code;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function looksLikeUnavailableFile(message?: string, code?: string | number): boolean {
  const haystack = `${String(code ?? "")} ${message ?? ""}`.toLowerCase();
  return (
    /infring|copyright|dmca/.test(haystack) ||
    /unavailable|not\s+available/.test(haystack) ||
    /file\s+not\s+allowed|not\s+allowed/.test(haystack) ||
    /invalid\s+file|unsupported\s+hoster/.test(haystack) ||
    /hoster.*(maintenance|temporarily)/.test(haystack)
  );
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000));
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function backoffWithJitter(attempt: number, initialMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt));
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function intParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Real-Debrid torrent status: ${String(value)}`);
}
```

## Rate limiting model

Real-Debrid allows roughly 250 requests per minute. Cloudflare Workers do not provide a single long-lived process for your whole account. A top-level variable may be reused by one isolate, but another request may land in another isolate, and any isolate may be evicted. Because of that, do not rely on `setInterval` to refill a shared bucket between requests.

Use the included `InMemoryTokenBucketLimiter` only as a best-effort local smoother. It lazily refills on `acquire()` and is fine for a personal Worker with low concurrency.

For production or multi-user traffic, bind `RDRateLimiterDurableObject` and create one named object per Real-Debrid account. Durable Objects serialize access to that object, so the token bucket is enforced across Worker isolates. The Durable Object also lazily refills on demand, so it does not depend on a background interval.

Example binding shape:

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "RD_RATE_LIMITER"
class_name = "RDRateLimiterDurableObject"
```

## Retry and idempotency rules

`GET /torrents/info/{id}` and `GET /downloads` are safe to retry on network errors, 429, and transient 5xx responses.

`POST /torrents/selectFiles/{id}` is treated as retry-safe when the exact same file selection is repeated for the same torrent. If Real-Debrid replies that the action is already done, the client treats that as success.

`POST /torrents/addMagnet` is not retry-safe for network errors or 5xx responses because Real-Debrid does not provide a client idempotency key. If the request succeeds server-side but the response is lost, retrying can create a duplicate torrent. This client retries `addMagnet` only after an explicit 429, where the request was rate-limited and should be retried after the advertised delay.

`POST /unrestrict/link` is also not retried for network errors or 5xx responses by default, because it can create account-side download history or consume hoster limits. It is retried only for explicit 429 rate limiting.

## Worker boundary design

The browser must never receive the Real-Debrid API token. Store it as a Worker secret, instantiate `RealDebridClient` only inside the Worker, and return only sanitized application responses.

```ts
import {
  DurableObjectRateLimiterClient,
  InMemoryTokenBucketLimiter,
  RDAPIError,
  RDAuthExpiredError,
  RDPremiumRequiredError,
  RDRateLimitedError,
  RDTransientUpstreamError,
  RDUnavailableFileError,
  RealDebridClient,
  type RDFileSelection,
} from "./realdebrid";

export interface Env {
  RD_API_TOKEN: string;
  RD_RATE_LIMITER?: DurableObjectNamespace;
}

const bestEffortLimiter = new InMemoryTokenBucketLimiter({
  capacity: 250,
  requestsPerMinute: 240,
});

function makeClient(env: Env): RealDebridClient {
  const limiter = env.RD_RATE_LIMITER
    ? new DurableObjectRateLimiterClient(
        env.RD_RATE_LIMITER.get(env.RD_RATE_LIMITER.idFromName("real-debrid-account")),
        { capacity: 250, requestsPerMinute: 240 },
      )
    : bestEffortLimiter;

  return new RealDebridClient({
    apiToken: env.RD_API_TOKEN,
    limiter,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rd = makeClient(env);
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/api/unrestrict") {
        const body = await request.json<{ link: string; password?: string }>();
        const unrestricted = await rd.unrestrictLink(body.link, { password: body.password });
        return json({ filename: unrestricted.filename, download: unrestricted.download });
      }

      if (request.method === "POST" && url.pathname === "/api/torrents/magnet") {
        const body = await request.json<{ magnet: string; files?: RDFileSelection }>();
        const added = await rd.addMagnet(body.magnet);
        const torrent = await rd.pollTorrentUntilDownloaded(added.id, {
          timeoutMs: 20 * 60_000,
          onWaitingFilesSelection: body.files ?? "all",
        });
        return json({ id: added.id, status: torrent.status, links: torrent.links });
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/torrents/") && url.pathname.endsWith("/files")) {
        const torrentId = url.pathname.split("/")[3];
        const body = await request.json<{ files: RDFileSelection }>();
        await rd.selectFiles(torrentId, body.files);
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/api/downloads") {
        const downloads = await rd.listDownloads({
          page: numberQuery(url, "page"),
          limit: numberQuery(url, "limit") ?? 50,
        });
        return json({ downloads });
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      return publicError(error);
    }
  },
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function numberQuery(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function publicError(error: unknown): Response {
  // Do not serialize raw upstream headers, request init objects, or env values.
  // The token only exists in env.RD_API_TOKEN and the Authorization header sent
  // from Worker to Real-Debrid.
  if (error instanceof RDAuthExpiredError) {
    return json({ error: "real_debrid_auth_failed" }, 502);
  }
  if (error instanceof RDPremiumRequiredError) {
    return json({ error: "real_debrid_permission_or_premium_required" }, 403);
  }
  if (error instanceof RDUnavailableFileError) {
    return json({ error: "real_debrid_file_unavailable" }, 422);
  }
  if (error instanceof RDRateLimitedError) {
    const retryAfterSeconds = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1_000) : 5;
    return json(
      { error: "real_debrid_rate_limited", retryAfterMs: error.retryAfterMs ?? retryAfterSeconds * 1_000 },
      503,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
  if (error instanceof RDTransientUpstreamError) {
    return json({ error: "real_debrid_transient_upstream_error" }, 502);
  }
  if (error instanceof RDAPIError) {
    return json({ error: "real_debrid_error" }, 502);
  }
  return json({ error: "internal_error" }, 500);
}
```

For long torrent downloads, the clean production boundary is usually: browser submits magnet to the Worker, Worker stores a job in a Durable Object, Queue, or database, and the browser polls your Worker for job status. You can still use `pollTorrentUntilDownloaded()` inside that background job, but do not depend on a browser request or an in-memory interval staying alive indefinitely.
