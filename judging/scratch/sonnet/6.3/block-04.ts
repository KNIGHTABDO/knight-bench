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
