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
