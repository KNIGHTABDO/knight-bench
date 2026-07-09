// SubtitleSyncer.ts

/** A single subtitle cue, using milliseconds internally for precision and to avoid
 *  float-second accumulation error over long files. */
interface Cue {
  index: number;       // original SRT sequence number (informational only, re-numbered on export)
  startMs: number;
  endMs: number;
  text: string;
}

interface Anchor {
  subtitleTime: number; // seconds, as authored in the SRT
  videoTime: number;    // seconds, actual playback position when that line was heard
}

interface SyncTransform {
  a: number; // scale
  b: number; // offset, in ms
}

const SRT_TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

export class SubtitleSyncer {
  private cues: Cue[] = [];
  private transform: SyncTransform = { a: 1, b: 0 };
  /** Parallel array of (corrected) start times, kept sorted, used for binary search. */
  private sortedStarts: number[] = [];
  private sortIndex: number[] = []; // sortedStarts[i] corresponds to cues[sortIndex[i]]

  // ---------------------------------------------------------------------
  // PARSING
  // ---------------------------------------------------------------------

  /**
   * Parses raw SRT text into cues. Tolerant of:
   *  - UTF-8 BOM
   *  - CRLF / LF / lone CR line endings
   *  - malformed/partial timestamps (falls back to skipping the cue, logs a warning,
   *    never throws — one bad block shouldn't kill the whole file)
   *  - comma OR period as the ms separator (some tools emit '.')
   *  - overlapping cues (kept as-is at parse time; overlap is a *rendering* concern,
   *    resolved in getActiveCues / export, not silently dropped here)
   *  - blank-line-separated blocks with possibly missing index lines or extra blank lines
   */
  parseSRT(raw: string): { cueCount: number; warnings: string[] } {
    const warnings: string[] = [];

    // Strip BOM (UTF-8 EF BB BF, or the decoded U+FEFF if the file was already
    // decoded to a JS string by the caller's file reader).
    let text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

    // Normalize all line-ending variants to \n.
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Split into blocks on one-or-more blank lines. Trim to drop leading/trailing junk.
    const blocks = text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    const parsed: Cue[] = [];

    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim());

      // Find the timestamp line anywhere in the block — some malformed files
      // omit the index line, or have stray whitespace-only lines first.
      const tsLineIdx = lines.findIndex((l) => SRT_TIME_RE.test(l));
      if (tsLineIdx === -1) {
        warnings.push(`Skipped block with no parseable timestamp: "${block.slice(0, 60)}..."`);
        continue;
      }

      const m = lines[tsLineIdx].match(SRT_TIME_RE)!;
      const startMs = this.hmsToMs(m[1], m[2], m[3], m[4]);
      const endMs = this.hmsToMs(m[5], m[6], m[7], m[8]);

      if (startMs === null || endMs === null) {
        warnings.push(`Skipped block with unparseable timestamp values: "${lines[tsLineIdx]}"`);
        continue;
      }

      let s = startMs, e = endMs;
      if (e <= s) {
        // Malformed: zero or negative duration. Clamp to a minimum visible duration
        // rather than dropping the cue outright — better to show something briefly
        // than silently lose a line of dialogue.
        warnings.push(
          `Cue at ${s}ms has end <= start (${e}ms); clamped to ${s + 500}ms`
        );
        e = s + 500;
      }

      const textLines = lines.slice(tsLineIdx + 1).filter((l) => l.length > 0);
      const text = textLines.join("\n");
      if (text.length === 0) {
        warnings.push(`Skipped cue at ${s}ms with no text content`);
        continue;
      }

      parsed.push({ index: parsed.length + 1, startMs: s, endMs: e, text });
    }

    // Sort by start time — malformed/hand-edited files aren't always monotonic,
    // and we need monotonic starts for binary search later.
    parsed.sort((x, y) => x.startMs - y.startMs);

    // Overlap detection is informational at parse time; we don't mutate cues here
    // because overlaps may be *intentional* (e.g. two speakers). We just log them.
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].startMs < parsed[i - 1].endMs) {
        warnings.push(
          `Overlap: cue ${parsed[i - 1].index} (ends ${parsed[i - 1].endMs}ms) overlaps ` +
          `cue ${parsed[i].index} (starts ${parsed[i].startMs}ms)`
        );
      }
    }

    this.cues = parsed;
    this.rebuildIndex();
    return { cueCount: parsed.length, warnings };
  }

  private hmsToMs(h: string, m: string, s: string, ms: string): number | null {
    const hh = parseInt(h, 10);
    const mm = parseInt(m, 10);
    const ss = parseInt(s, 10);
    // ms field may be 1-3 digits (".5" vs ",500") — normalize to milliseconds.
    const msNormalized = parseInt(ms.padEnd(3, "0").slice(0, 3), 10);
    if ([hh, mm, ss, msNormalized].some((v) => Number.isNaN(v))) return null;
    if (mm >= 60 || ss >= 60) return null; // reject nonsense like 00:75:00
    return ((hh * 60 + mm) * 60 + ss) * 1000 + msNormalized;
  }

  // ---------------------------------------------------------------------
  // ANCHOR-BASED CORRECTION
  // ---------------------------------------------------------------------

  /**
   * Computes (a, b) from user anchors and applies the correction to all cues.
   * - 0 anchors: no-op, identity transform.
   * - 1 anchor: offset-only (a fixed at 1).
   * - 2 anchors: exact two-point line solve.
   * - 3+ anchors: least-squares regression.
   */
  applyAnchors(anchors: Anchor[]): SyncTransform {
    if (anchors.length === 0) {
      this.transform = { a: 1, b: 0 };
      this.rebuildIndex();
      return this.transform;
    }

    // Work in ms internally for consistency with cue storage.
    const pts = anchors.map((an) => ({
      s: an.subtitleTime * 1000,
      v: an.videoTime * 1000,
    }));

    let a: number, b: number;

    if (pts.length === 1) {
      a = 1;
      b = pts[0].v - pts[0].s;
    } else if (pts.length === 2) {
      const [p1, p2] = pts;
      const ds = p2.s - p1.s;
      if (Math.abs(ds) < 1) {
        // Anchors on (essentially) the same subtitle time — can't determine slope.
        // Fall back to offset-only using their average, and warn via thrown info
        // the caller can catch/display; we choose not to throw to keep UX smooth.
        a = 1;
        b = (p1.v - p1.s + (p2.v - p2.s)) / 2;
      } else {
        a = (p2.v - p1.v) / ds;
        b = p1.v - a * p1.s;
      }
    } else {
      // Least squares over n >= 3 points.
      const n = pts.length;
      const sBar = pts.reduce((acc, p) => acc + p.s, 0) / n;
      const vBar = pts.reduce((acc, p) => acc + p.v, 0) / n;

      let num = 0, den = 0;
      for (const p of pts) {
        const ds = p.s - sBar;
        num += ds * (p.v - vBar);
        den += ds * ds;
      }

      if (Math.abs(den) < 1e-9) {
        // All anchors share (essentially) the same subtitle time -> zero variance.
        // Degenerate: fall back to mean offset, a = 1.
        a = 1;
        b = vBar - sBar;
      } else {
        a = num / den;
        b = vBar - a * sBar;
      }
    }

    // Sanity clamp: guard against a wildly implausible scale from bad taps
    // (e.g. accidental double-tap on the same instant). Real-world framerate
    // ratios fall roughly within 0.5x-2x; anything outside that is almost
    // certainly a bad anchor pair, not a real correction.
    const A_MIN = 0.5, A_MAX = 2.0;
    if (!Number.isFinite(a) || a < A_MIN || a > A_MAX) {
      a = Math.min(A_MAX, Math.max(A_MIN, Number.isFinite(a) ? a : 1));
    }
    if (!Number.isFinite(b)) b = 0;

    this.transform = { a, b };
    this.rebuildIndex();
    return this.transform;
  }

  /** Applies the current transform to a raw (uncorrected) ms timestamp. */
  private correct(rawMs: number): number {
    return this.transform.a * rawMs + this.transform.b;
  }

  // ---------------------------------------------------------------------
  // QUERY: O(log n) active-cue lookup
  // ---------------------------------------------------------------------

  /** Rebuilds the sorted-starts index used for binary search after any
   *  parse or transform change. Cues are stored with their ORIGINAL (raw)
   *  times; correction is applied on the fly, since re-deriving corrected
   *  arrays on every applyAnchors() call is O(n) anyway and this keeps
   *  a single source of truth. */
  private rebuildIndex(): void {
    this.sortIndex = this.cues.map((_, i) => i).sort((i, j) => {
      const ai = this.correct(this.cues[i].startMs);
      const aj = this.correct(this.cues[j].startMs);
      return ai - aj;
    });
    this.sortedStarts = this.sortIndex.map((i) => this.correct(this.cues[i].startMs));
  }

  /**
   * Returns all cues active at videoTime (seconds), corrected-time-aware.
   * Because cues can overlap (either originally, or induced by a negative-drift
   * correction squeezing cues together), this returns an array, not a single cue.
   *
   * O(log n) to find the insertion point via binary search, then a small
   * linear scan strictly bounded by local overlap (typically 0-2 cues) rather
   * than the whole cue list.
   */
  getActiveCues(videoTime: number): Cue[] {
    const vMs = videoTime * 1000;
    const n = this.sortedStarts.length;
    if (n === 0) return [];

    // Binary search: find rightmost index with start <= vMs.
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedStarts[mid] <= vMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans === -1) return [];

    const active: Cue[] = [];

    // Walk backward from `ans` while corrected end times could still cover vMs.
    // Bounded scan: stop once a cue's *start* is far enough in the past that
    // even the longest plausible cue duration couldn't reach vMs. This keeps
    // pathological O(n) overlap chains from degrading the query, while still
    // being correct for the normal case of a handful of overlapping cues.
    const MAX_LOOKBACK_MS = 20000; // no single subtitle cue realistically exceeds ~20s
    for (let i = ans; i >= 0; i--) {
      const cue = this.cues[this.sortIndex[i]];
      const cStart = this.correct(cue.startMs);
      const cEnd = this.correct(cue.endMs);
      if (vMs - cStart > MAX_LOOKBACK_MS) break;
      if (cStart <= vMs && vMs < cEnd) {
        active.push(cue);
      }
    }

    return active.sort((x, y) => x.startMs - y.startMs);
  }

  // ---------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------

  /**
   * Exports corrected cues as SRT text. Applies edge-case handling
   * (negative-time clamp, overlap resolution) described in section 4,
   * then re-numbers sequentially per the SRT spec.
   */
  exportSRT(): string {
    const corrected = this.cues
      .map((c) => ({
        startMs: this.correct(c.startMs),
        endMs: this.correct(c.endMs),
        text: c.text,
      }))
      .sort((x, y) => x.startMs - y.startMs);

    const fixed = this.resolveEdgeCases(corrected);

    return fixed
      .map((c, i) => {
        return [
          String(i + 1),
          `${this.msToSrtTime(c.startMs)} --> ${this.msToSrtTime(c.endMs)}`,
          c.text,
          "",
        ].join("\n");
      })
      .join("\n");
  }

  private resolveEdgeCases(
    cues: { startMs: number; endMs: number; text: string }[]
  ): { startMs: number; endMs: number; text: string }[] {
    const MIN_DURATION_MS = 300;
    const out: { startMs: number; endMs: number; text: string }[] = [];

    for (const c of cues) {
      let start = c.startMs;
      let end = c.endMs;

      // Negative-time clamp: correction can push early cues before t=0
      // (e.g. large negative offset, or scale < 1 combined with negative b).
      if (start < 0) {
        // If the whole cue would have already ended before t=0, drop it —
        // it can never be shown.
        if (end <= 0) continue;
        start = 0;
      }
      if (end <= start) {
        end = start + MIN_DURATION_MS;
      }

      // Overlap resolution against the previous kept cue: if this cue's
      // corrected start is before the previous cue's corrected end, trim
      // the previous cue's end to this cue's start (never drop text —
      // dialogue matters more than a moment of double-display, but we
      // prioritize giving each line unobstructed screen time in order).
      const prev = out[out.length - 1];
      if (prev && start < prev.endMs) {
        // Only trim if trimming doesn't invert the previous cue
        // (i.e. leaves at least a minimal sliver visible); otherwise
        // let them intentionally overlap (two simultaneous speakers).
        const trimmedPrevEnd = start;
        if (trimmedPrevEnd - prev.startMs >= MIN_DURATION_MS) {
          prev.endMs = trimmedPrevEnd;
        }
        // else: leave the overlap as-is; most players handle brief
        // overlapping cues fine (stacked lines).
      }

      out.push({ startMs: start, endMs: end, text: c.text });
    }

    return out;
  }

  private msToSrtTime(ms: number): string {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    ms -= h * 3600000;
    const m = Math.floor(ms / 60000);
    ms -= m * 60000;
    const s = Math.floor(ms / 1000);
    ms -= s * 1000;
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  // ---------------------------------------------------------------------
  // Accessors used by the auto-detection path (section 3) and tests.
  // ---------------------------------------------------------------------

  getCues(): readonly Cue[] {
    return this.cues;
  }

  getTransform(): SyncTransform {
    return this.transform;
  }
}
