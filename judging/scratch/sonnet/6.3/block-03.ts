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
