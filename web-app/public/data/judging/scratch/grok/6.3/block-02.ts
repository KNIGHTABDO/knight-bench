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
