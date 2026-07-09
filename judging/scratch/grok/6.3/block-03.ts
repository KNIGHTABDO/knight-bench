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
