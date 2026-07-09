// ============================================================================
// 1. Error Taxonomy
// ============================================================================

export abstract class RealDebridError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RealDebridAuthError extends RealDebridError {
  constructor(message = "Unauthorized: API token is invalid or expired") {
    super(message, 401);
  }
}

export class RealDebridPremiumError extends RealDebridError {
  constructor(message = "Forbidden: Premium account or specific permissions required") {
    super(message, 403);
  }
}

export class RealDebridInfringingError extends RealDebridError {
  constructor(message = "File is unavailable due to infringement or copyright claim") {
    super(message, 403);
  }
}

export class RealDebridRateLimitError extends RealDebridError {
  constructor(public readonly retryAfterSeconds: number, message = "Too many requests. Rate limit exceeded.") {
    super(message, 429);
  }
}

export class RealDebridTransientError extends RealDebridError {
  constructor(message = "Transient upstream error", status = 503) {
    super(message, status);
  }
}

export class RealDebridHttpError extends RealDebridError {
  constructor(status: number, message: string) {
    super(`HTTP Error ${status}: ${message}`, status);
  }
}

// ============================================================================
// 2. Types & Interfaces
// ============================================================================

export type TorrentStatus =
  | "magnet_conversion"
  | "waiting_files_selection"
  | "queued"
  | "downloading"
  | "downloaded"
  | "error"
  | "virus"
  | "dead";

export interface UnrestrictLinkResponse {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string; // The unrestricted link
  host: string;
  chunks: number;
  download: string;
  streamable: number;
}

export interface AddMagnetResponse {
  id: string;
  uri: string;
}

export interface TorrentFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

export interface TorrentInfo {
  id: string;
  filename: string;
  original_filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  host: string;
  split: number;
  progress: number;
  status: TorrentStatus;
  statusCode?: number;
  added: string;
  files: TorrentFile[];
  links: string[];
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface DownloadItem {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  download: string;
  streamable: number;
  generated: string;
}

export interface RateLimiter {
  acquire(tokens?: number): Promise<void>;
  report429(retryAfterSeconds: number): void;
}

export interface PollOptions {
  timeoutMs?: number;         // Hard timeout for the polling operation
  initialDelayMs?: number;    // Initial delay before first poll / step
  maxDelayMs?: number;        // Max backoff delay between polls
  backoffFactor?: number;     // Exponential factor
  jitter?: boolean;           // Apply randomized jitter
  onProgress?: (status: TorrentStatus, info: TorrentInfo) => void;
}

// ============================================================================
// 3. Per-Isolate Best-Effort Token Bucket Limiter
// ============================================================================

export class LocalTokenBucketLimiter implements RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // Tokens per millisecond
  private globalBackoffUntil = 0;

  constructor(maxTokens = 50, refillRatePerMinute = 250) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerMinute / (60 * 1000);
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  public report429(retryAfterSeconds: number): void {
    this.globalBackoffUntil = Date.now() + (retryAfterSeconds * 1000);
    this.tokens = 0; // Drain bucket
  }

  public async acquire(tokensRequired = 1): Promise<void> {
    const now = Date.now();
    if (now < this.globalBackoffUntil) {
      const wait = this.globalBackoffUntil - now;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    this.refill();

    if (this.tokens >= tokensRequired) {
      this.tokens -= tokensRequired;
      return;
    }

    const missing = tokensRequired - this.tokens;
    const delay = missing / this.refillRate;
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

// ============================================================================
// 4. Real-Debrid API Client
// ============================================================================

export class RealDebridClient {
  private readonly baseUrl = "https://api.real-debrid.com/rest/1.0";

  constructor(
    private readonly apiKey: string,
    private readonly rateLimiter: RateLimiter = new LocalTokenBucketLimiter()
  ) {}

  /**
   * Helper function to execute fetch calls with rate-limiting, custom error mapping,
   * and handling of transient upstream errors.
   */
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    body?: URLSearchParams,
    allowRetry = false,
    retryCount = 0
  ): Promise<T> {
    await this.rateLimiter.acquire(1);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (method === "POST" && body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const options: RequestInit = {
      method,
      headers,
      body: method === "POST" ? body?.toString() : undefined,
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);

      if (response.ok) {
        // Some deletion or action endpoints return 204 No Content
        if (response.status === 204) {
          return {} as T;
        }
        return (await response.json()) as T;
      }

      // Handle Errors explicitly
      if (response.status === 401) {
        throw new RealDebridAuthError();
      }

      if (response.status === 403) {
        const errorJson: any = await response.json().catch(() => ({}));
        // Real-Debrid returns specific codes for infringements
        if (errorJson.error_code === 30 || /infringement|copyright/i.test(errorJson.error || "")) {
          throw new RealDebridInfringingError();
        }
        throw new RealDebridPremiumError();
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
        this.rateLimiter.report429(retryAfterSeconds);
        throw new RealDebridRateLimitError(retryAfterSeconds);
      }

      // 5xx and other transient codes
      if (response.status >= 500 && response.status < 600) {
        if (allowRetry && retryCount < 3) {
          const backoff = Math.pow(2, retryCount) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          return this.request<T>(method, endpoint, body, allowRetry, retryCount + 1);
        }
        throw new RealDebridTransientError(
          `Upstream service error: ${response.statusText}`,
          response.status
        );
      }

      throw new RealDebridHttpError(response.status, response.statusText);
    } catch (error) {
      if (error instanceof RealDebridError) {
        throw error;
      }
      // Handle network errors as transient
      if (allowRetry && retryCount < 3) {
        const backoff = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        return this.request<T>(method, endpoint, body, allowRetry, retryCount + 1);
      }
      throw new RealDebridTransientError((error as Error).message || "Network error");
    }
  }

  /**
   * Unrestricts a hoster or torrent download link.
   * RETRY-SAFE: Yes. Safe to retry if transient error occurred.
   */
  public async unrestrictLink(link: string): Promise<UnrestrictLinkResponse> {
    const params = new URLSearchParams();
    params.append("link", link);
    return this.request<UnrestrictLinkResponse>("POST", "/unrestrict/link", params, true);
  }

  /**
   * Adds a magnet link to the user's torrent queue.
   * RETRY-SAFE: No. Retrying on a timeout might create duplicates.
   */
  public async addMagnet(magnet: string): Promise<AddMagnetResponse> {
    const params = new URLSearchParams();
    params.append("magnet", magnet);
    // allowRetry = false to prevent duplicate creations
    return this.request<AddMagnetResponse>("POST", "/torrents/addMagnet", params, false);
  }

  /**
   * Selects specific file IDs from a torrent.
   * RETRY-SAFE: Yes. State-setting POST endpoint.
   */
  public async selectFiles(torrentId: string, fileIds: string[] | "all"): Promise<void> {
    const params = new URLSearchParams();
    const filesString = Array.isArray(fileIds) ? fileIds.join(",") : fileIds;
    params.append("files", filesString);
    return this.request<void>("POST", `/torrents/selectFiles/${torrentId}`, params, true);
  }

  /**
   * Retrieves detailed status for a single torrent.
   * RETRY-SAFE: Yes. Read-only operation.
   */
  public async getTorrentInfo(torrentId: string): Promise<TorrentInfo> {
    return this.request<TorrentInfo>("GET", `/torrents/info/${torrentId}`, undefined, true);
  }

  /**
   * Lists the user's generated downloads.
   * RETRY-SAFE: Yes. Read-only operation.
   */
  public async listDownloads(page = 1, limit = 50): Promise<DownloadItem[]> {
    return this.request<DownloadItem[]>(
      "GET",
      `/downloads?page=${page}&limit=${limit}`,
      undefined,
      true
    );
  }

  /**
   * State Machine status polling for torrent completion with exponential backoff & jitter.
   * Handles all Real-Debrid torrent statuses explicitly.
   */
  public async pollTorrent(torrentId: string, options: PollOptions = {}): Promise<TorrentInfo> {
    const {
      timeoutMs = 600000, // Default 10 minutes
      initialDelayMs = 2000,
      maxDelayMs = 30000,
      backoffFactor = 1.5,
      jitter = true,
      onProgress,
    } = options;

    const startTime = Date.now();
    let delay = initialDelayMs;

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Polling timed out for torrent: ${torrentId} after ${timeoutMs}ms`);
      }

      const info = await this.getTorrentInfo(torrentId);

      if (onProgress) {
        onProgress(info.status, info);
      }

      switch (info.status) {
        // -------------------------------------------------------------
        // Terminal Successful State
        // -------------------------------------------------------------
        case "downloaded":
          return info;

        // -------------------------------------------------------------
        // Terminal Failure States
        // -------------------------------------------------------------
        case "error":
          throw new Error(`Torrent ${torrentId} failed with status: error`);
        case "virus":
          throw new Error(`Torrent ${torrentId} contained a virus and was blocked`);
        case "dead":
          throw new Error(`Torrent ${torrentId} is dead (no seeds/unresolvable)`);

        // -------------------------------------------------------------
        // Special Non-Terminal State requiring intervention
        // -------------------------------------------------------------
        case "waiting_files_selection":
          // Returning early to allow calling logic to select files
          return info;

        // -------------------------------------------------------------
        // Expected In-Progress States
        // -------------------------------------------------------------
        case "magnet_conversion":
        case "queued":
        case "downloading":
          break;

        default: {
          const exhaustiveCheck: never = info.status;
          throw new Error(`Unknown torrent status encountered: ${exhaustiveCheck}`);
        }
      }

      // Calculate exponential delay with randomized jitter
      let nextDelay = delay * backoffFactor;
      if (jitter) {
        // Randomize the delay to avoid thundering herd problem
        const minJitter = 0.85;
        const maxJitter = 1.15;
        const randomMultiplier = Math.random() * (maxJitter - minJitter) + minJitter;
        nextDelay = nextDelay * randomMultiplier;
      }
      delay = Math.min(nextDelay, maxDelayMs);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
