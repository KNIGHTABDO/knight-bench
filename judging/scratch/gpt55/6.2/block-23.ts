type Anchor = {
  /** Original subtitle timeline time in seconds. */
  subtitleTime: number;
  /** Actual video time in seconds when that subtitle moment is spoken. */
  videoTime: number;
};

type SubtitleCue = {
  /** Original numeric index if present. Export regenerates clean indices. */
  index?: number;
  /** Original parsed start time in seconds. */
  originalStart: number;
  /** Original parsed end time in seconds. */
  originalEnd: number;
  /** Corrected start time in seconds. */
  start: number;
  /** Corrected end time in seconds. */
  end: number;
  /** Raw subtitle payload lines joined with \n. */
  text: string;
};

type SyncModel = {
  offset: number;
  scale: number;
  anchorCount: number;
  method: "none" | "offset" | "two-point" | "least-squares";
  residuals: number[];
};

class SubtitleSyncer {
  private cues: SubtitleCue[] = [];
  private model: SyncModel = {
    offset: 0,
    scale: 1,
    anchorCount: 0,
    method: "none",
    residuals: [],
  };

  /**
   * endPrefixMax[i] is the maximum cue end time among cues[0..i].
   * It lets getActiveCues skip leftward ranges that cannot overlap videoTime.
   */
  private endPrefixMax: number[] = [];

  constructor(srt?: string) {
    if (srt !== undefined) {
      this.parseSRT(srt);
    }
  }

  parseSRT(srt: string): SubtitleCue[] {
    const normalized = srt
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    const blocks = normalized
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    const parsed: SubtitleCue[] = [];

    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.length === 0) continue;

      let cursor = 0;
      let index: number | undefined;

      const first = lines[cursor]?.trim() ?? "";
      if (/^\d+$/.test(first)) {
        index = Number(first);
        cursor += 1;
      }

      const timingLine = lines[cursor]?.trim();
      if (!timingLine) continue;

      const timing = this.parseTimingLine(timingLine);
      if (!timing) {
        // Malformed timestamp block: ignore the block rather than poisoning playback.
        continue;
      }

      cursor += 1;
      const text = lines.slice(cursor).join("\n").trimEnd();
      if (!text) {
        // Empty cues are not useful for display. Skip them.
        continue;
      }

      let { start, end } = timing;

      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start < 0) start = 0;
      if (end < 0) end = 0;
      if (end < start) end = start;

      parsed.push({
        index,
        originalStart: start,
        originalEnd: end,
        start,
        end,
        text,
      });
    }

    this.cues = parsed;
    this.sortAndRebuildIndex();
    this.model = {
      offset: 0,
      scale: 1,
      anchorCount: 0,
      method: "none",
      residuals: [],
    };

    return this.getCues();
  }

  getCues(): SubtitleCue[] {
    return this.cues.map((cue) => ({ ...cue }));
  }

  getSyncModel(): SyncModel {
    return {
      ...this.model,
      residuals: [...this.model.residuals],
    };
  }

  applyAnchors(anchors: Anchor[]): SyncModel {
    const clean = anchors
      .filter(
        (anchor) =>
          Number.isFinite(anchor.subtitleTime) &&
          Number.isFinite(anchor.videoTime) &&
          anchor.subtitleTime >= 0 &&
          anchor.videoTime >= 0,
      )
      .sort((a, b) => a.subtitleTime - b.subtitleTime);

    let offset = 0;
    let scale = 1;
    let method: SyncModel["method"] = "none";

    if (clean.length === 0) {
      offset = 0;
      scale = 1;
      method = "none";
    } else if (clean.length === 1) {
      offset = clean[0].videoTime - clean[0].subtitleTime;
      scale = 1;
      method = "offset";
    } else if (clean.length === 2) {
      const [p1, p2] = clean;
      const ds = p2.subtitleTime - p1.subtitleTime;
      const dv = p2.videoTime - p1.videoTime;

      if (Math.abs(ds) < 1e-9) {
        // Same subtitle instant tapped twice: scale is unknowable.
        scale = 1;
        offset = average(clean.map((p) => p.videoTime - p.subtitleTime));
        method = "offset";
      } else {
        scale = dv / ds;
        offset = p1.videoTime - scale * p1.subtitleTime;
        method = "two-point";
      }
    } else {
      const meanS = average(clean.map((p) => p.subtitleTime));
      const meanV = average(clean.map((p) => p.videoTime));

      let numerator = 0;
      let denominator = 0;

      for (const p of clean) {
        const centeredS = p.subtitleTime - meanS;
        const centeredV = p.videoTime - meanV;
        numerator += centeredS * centeredV;
        denominator += centeredS * centeredS;
      }

      if (Math.abs(denominator) < 1e-9) {
        scale = 1;
        offset = average(clean.map((p) => p.videoTime - p.subtitleTime));
        method = "offset";
      } else {
        scale = numerator / denominator;
        offset = meanV - scale * meanS;
        method = "least-squares";
      }
    }

    // Pathological anchors can imply negative or zero scale. That reverses time and
    // breaks the subtitle timeline. Keep the system usable by falling back to offset.
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
      offset = clean.length > 0 ? average(clean.map((p) => p.videoTime - p.subtitleTime)) : 0;
      method = clean.length > 0 ? "offset" : "none";
    }

    if (!Number.isFinite(offset)) {
      offset = 0;
      scale = 1;
      method = "none";
    }

    for (const cue of this.cues) {
      let correctedStart = offset + scale * cue.originalStart;
      let correctedEnd = offset + scale * cue.originalEnd;

      if (!Number.isFinite(correctedStart)) correctedStart = 0;
      if (!Number.isFinite(correctedEnd)) correctedEnd = correctedStart;

      // Negative corrected times cannot be represented in SRT and are not playable.
      correctedStart = Math.max(0, correctedStart);
      correctedEnd = Math.max(0, correctedEnd);

      if (correctedEnd < correctedStart) {
        correctedEnd = correctedStart;
      }

      cue.start = correctedStart;
      cue.end = correctedEnd;
    }

    this.sortAndRebuildIndex();

    const residuals = clean.map((p) => offset + scale * p.subtitleTime - p.videoTime);

    this.model = {
      offset,
      scale,
      anchorCount: clean.length,
      method,
      residuals,
    };

    return this.getSyncModel();
  }

  /**
   * Returns cues active at videoTime.
   *
   * Complexity:
   * - O(log n) to find the first cue whose start is greater than videoTime.
   * - Then scans left only while prefix maximum end time says an overlap is still possible.
   * - Output cost is O(k), where k is the number of overlapping active cues plus nearby
   *   overlapping candidates that must be checked.
   */
  getActiveCues(videoTime: number): SubtitleCue[] {
    if (!Number.isFinite(videoTime) || videoTime < 0 || this.cues.length === 0) {
      return [];
    }

    const insertionPoint = this.upperBoundStart(videoTime);
    const active: SubtitleCue[] = [];

    for (let i = insertionPoint - 1; i >= 0; i -= 1) {
      if (this.endPrefixMax[i] < videoTime) {
        break;
      }

      const cue = this.cues[i];
      if (cue.start <= videoTime && videoTime < cue.end) {
        active.push({ ...cue });
      }
    }

    // Scanning left returns reverse start order.
    active.reverse();
    return active;
  }

  exportSRT(): string {
    return this.cues
      .map((cue, i) => {
        const start = formatSrtTimestamp(cue.start);
        const end = formatSrtTimestamp(Math.max(cue.end, cue.start));
        return `${i + 1}\n${start} --> ${end}\n${cue.text}`;
      })
      .join("\n\n");
  }

  private parseTimingLine(line: string): { start: number; end: number } | null {
    const match = line.match(
      /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/,
    );

    if (!match) return null;

    const start = parseSrtTimestamp(match[1]);
    const end = parseSrtTimestamp(match[2]);

    if (start === null || end === null) return null;
    return { start, end };
  }

  private sortAndRebuildIndex(): void {
    this.cues.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      return a.text.localeCompare(b.text);
    });

    this.endPrefixMax = [];
    let maxEnd = -Infinity;

    for (let i = 0; i < this.cues.length; i += 1) {
      maxEnd = Math.max(maxEnd, this.cues[i].end);
      this.endPrefixMax[i] = maxEnd;
    }
  }

  private upperBoundStart(videoTime: number): number {
    let lo = 0;
    let hi = this.cues.length;

    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (this.cues[mid].start <= videoTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }
}

function parseSrtTimestamp(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    !Number.isInteger(millis) ||
    minutes > 59 ||
    seconds > 59 ||
    millis > 999
  ) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatSrtTimestamp(timeSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0);

  // Round to milliseconds for SRT. Rounding is better than truncation because repeated
  // import/export cycles otherwise bias cues earlier.
  let totalMillis = Math.round(safe * 1000);

  const hours = Math.floor(totalMillis / 3_600_000);
  totalMillis -= hours * 3_600_000;

  const minutes = Math.floor(totalMillis / 60_000);
  totalMillis -= minutes * 60_000;

  const seconds = Math.floor(totalMillis / 1000);
  const millis = totalMillis - seconds * 1000;

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export { SubtitleSyncer, type Anchor, type SubtitleCue, type SyncModel };
