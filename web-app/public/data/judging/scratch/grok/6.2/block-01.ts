/**
 * SubtitleSyncer — parse SRT, affine-correct via anchors, query active cues in O(log n), export SRT.
 *
 * Model: videoTime = scale * subtitleTime + offset
 */

export interface Cue {
  index: number;
  start: number; // seconds, on current (possibly corrected) timeline
  end: number;
  text: string;
}

export interface Anchor {
  subtitleTime: number; // time on the *original* subtitle clock
  videoTime: number;    // user-marked video clock
}

export interface SyncParams {
  scale: number;  // a
  offset: number; // b  (seconds)
}

const EPS = 1e-9;
const MIN_CUE_DURATION = 0.04; // 40ms floor after correction

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Strip UTF-8 BOM and normalize newlines to \n */
function normalizeText(raw: string): string {
  let s = raw;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // Also handle UTF-8 BOM as bytes already decoded to U+FEFF
  if (s.startsWith("\uFEFF")) s = s.slice(1);
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Parse SRT timestamp: HH:MM:SS,mmm or HH:MM:SS.mmm
 * Also tolerates missing hours, single-digit fields, spaces.
 * Returns seconds or null if unrecoverable.
 */
function parseTimestamp(token: string): number | null {
  const t = token.trim().replace(",", ".");
  // HH:MM:SS.mmm | MM:SS.mmm | SS.mmm
  const m = t.match(
    /^(?:(\d{1,3}):)?(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,3}))?$/
  );
  if (!m) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let millis = 0;

  // Ambiguous groups: count colons in original
  const colons = (t.match(/:/g) || []).length;
  if (colons === 2) {
    hours = parseInt(m[1] ?? "0", 10);
    minutes = parseInt(m[2] ?? "0", 10);
    seconds = parseInt(m[3] ?? "0", 10);
  } else if (colons === 1) {
    minutes = parseInt(m[1] ?? m[2] ?? "0", 10);
    seconds = parseInt(m[3] ?? "0", 10);
  } else {
    seconds = parseInt(m[3] ?? "0", 10);
  }

  if (m[4] !== undefined) {
    // pad/truncate to 3 digits: "5" -> 500ms, "50" -> 500ms, "500" -> 500
    const frac = (m[4] + "000").slice(0, 3);
    millis = parseInt(frac, 10);
  }

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes >= 60 ||
    seconds >= 60
  ) {
    // Still accept slightly out-of-range minutes/seconds from bad files by folding
    // rather than dropping the cue entirely when only mildly malformed.
  }

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatTimestamp(seconds: number): string {
  // Clamp negatives to 0 for export display of clipped cues
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);

  // Handle ms rounding overflow (0.9995 -> 1000)
  let msFinal = ms;
  let secFinal = sec;
  let mFinal = m;
  let hFinal = h;
  if (msFinal >= 1000) {
    msFinal = 0;
    secFinal += 1;
  }
  if (secFinal >= 60) {
    secFinal = 0;
    mFinal += 1;
  }
  if (mFinal >= 60) {
    mFinal = 0;
    hFinal += 1;
  }

  const pad = (n: number, w: number) => n.toString().padStart(w, "0");
  return `${pad(hFinal, 2)}:${pad(mFinal, 2)}:${pad(secFinal, 2)},${pad(msFinal, 3)}`;
}

function parseTimeRange(line: string): { start: number; end: number } | null {
  // "00:01:02,000 --> 00:01:05,200" with optional position junk after end time
  const arrow = line.indexOf("-->");
  if (arrow < 0) return null;
  const left = line.slice(0, arrow).trim();
  // End token may be followed by " X1:..." positioning
  const rightPart = line.slice(arrow + 3).trim();
  const rightToken = rightPart.split(/\s+/)[0] ?? "";
  const start = parseTimestamp(left);
  const end = parseTimestamp(rightToken);
  if (start === null || end === null) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class SubtitleSyncer {
  /** Original cues (immutable after parse), times on subtitle clock */
  private original: Cue[] = [];

  /** Corrected cues, sorted by start time (then end) */
  private cues: Cue[] = [];

  /** Current affine params applied to original → cues */
  private params: SyncParams = { scale: 1, offset: 0 };

  // -------------------------------------------------------------------------
  // Parse
  // -------------------------------------------------------------------------

  /**
   * Parse SRT content. Tolerates:
   * - UTF-8 BOM
   * - CRLF / CR / LF
   * - Missing or non-sequential index numbers
   * - Comma or dot milliseconds
   * - Overlapping cues (kept; resolved later on correction/export)
   * - Trailing blank lines, empty text cues (dropped if no text)
   * - Malformed blocks skipped with optional onError callback
   */
  parseSRT(raw: string, onError?: (msg: string, block: string) => void): void {
    const text = normalizeText(raw);
    // Blocks separated by blank lines; also tolerate multiple blanks
    const blocks = text.split(/\n\s*\n/);
    const parsed: Cue[] = [];
    let autoIndex = 1;

    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trimEnd());
      // Drop leading/trailing empty lines within block
      while (lines.length && lines[0].trim() === "") lines.shift();
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      if (lines.length === 0) continue;

      let lineIdx = 0;
      // Optional numeric index line
      if (/^\d+$/.test(lines[0].trim())) {
        lineIdx = 1;
      }
      if (lineIdx >= lines.length) {
        onError?.("Block has index but no timing/text", block);
        continue;
      }

      const range = parseTimeRange(lines[lineIdx]);
      if (!range) {
        onError?.(`Malformed timestamp line: ${lines[lineIdx]}`, block);
        continue;
      }

      const textLines = lines.slice(lineIdx + 1);
      const cueText = textLines.join("\n").trim();
      if (!cueText) {
        onError?.("Empty cue text; skipping", block);
        continue;
      }

      let { start, end } = range;
      // Zero / inverted duration: give a minimal duration rather than drop
      if (end < start) {
        onError?.(`Inverted times ${start} > ${end}; swapping`, block);
        const tmp = start;
        start = end;
        end = tmp;
      }
      if (end - start < EPS) {
        end = start + MIN_CUE_DURATION;
      }

      parsed.push({
        index: autoIndex++,
        start,
        end,
        text: cueText,
      });
    }

    // Sort by start for binary search; stable secondary by end
    parsed.sort((a, b) => a.start - b.start || a.end - b.end);

    this.original = parsed.map((c) => ({ ...c }));
    this.params = { scale: 1, offset: 0 };
    this.cues = this.original.map((c) => ({ ...c }));
    // Overlaps in source are allowed; fixOverlaps only after correction if needed
  }

  // -------------------------------------------------------------------------
  // Anchors → affine fit
  // -------------------------------------------------------------------------

  /**
   * Fit scale & offset from anchors and rebuild corrected cue list.
   * - 0 anchors: identity
   * - 1 anchor: a = 1, b = v - s
   * - 2+ anchors: least squares (exact for n = 2 when non-degenerate)
   */
  applyAnchors(anchors: Anchor[]): SyncParams {
    if (!this.original.length) {
      this.params = { scale: 1, offset: 0 };
      this.cues = [];
      return { ...this.params };
    }

    const cleaned = anchors.filter(
      (a) =>
        Number.isFinite(a.subtitleTime) && Number.isFinite(a.videoTime)
    );

    let scale = 1;
    let offset = 0;

    if (cleaned.length === 0) {
      scale = 1;
      offset = 0;
    } else if (cleaned.length === 1) {
      scale = 1;
      offset = cleaned[0].videoTime - cleaned[0].subtitleTime;
    } else {
      const n = cleaned.length;
      let sumS = 0;
      let sumV = 0;
      for (const a of cleaned) {
        sumS += a.subtitleTime;
        sumV += a.videoTime;
      }
      const meanS = sumS / n;
      const meanV = sumV / n;

      let num = 0;
      let den = 0;
      for (const a of cleaned) {
        const ds = a.subtitleTime - meanS;
        num += ds * (a.videoTime - meanV);
        den += ds * ds;
      }

      if (Math.abs(den) < 1e-12) {
        // All subtitle times equal — pure offset
        scale = 1;
        offset = meanV - meanS;
      } else {
        scale = num / den;
        offset = meanV - scale * meanS;
      }

      // Guard: non-positive or absurd scale (anchors almost certainly wrong)
      if (!Number.isFinite(scale) || scale <= 0) {
        // Fall back to average pure offset
        scale = 1;
        offset =
          cleaned.reduce((s, a) => s + (a.videoTime - a.subtitleTime), 0) /
          cleaned.length;
      }
    }

    this.params = { scale, offset };
    this.rebuildCorrected();
    return { ...this.params };
  }

  /** Manually set params (e.g. from auto-detect) */
  setParams(params: SyncParams): void {
    const scale =
      Number.isFinite(params.scale) && params.scale > 0 ? params.scale : 1;
    const offset = Number.isFinite(params.offset) ? params.offset : 0;
    this.params = { scale, offset };
    this.rebuildCorrected();
  }

  getParams(): SyncParams {
    return { ...this.params };
  }

  // -------------------------------------------------------------------------
  // Correction pipeline + edge cases
  // -------------------------------------------------------------------------

  private rebuildCorrected(): void {
    const { scale, offset } = this.params;
    const raw: Cue[] = this.original.map((c, i) => {
      let start = scale * c.start + offset;
      let end = scale * c.end + offset;

      // Negative times after correction: clip to 0, preserve residual duration when possible
      if (end <= 0) {
        // Entirely before video start — mark for drop (filter later)
        return { index: i + 1, start: 0, end: 0, text: c.text };
      }
      if (start < 0) {
        start = 0;
      }
      if (end < start + MIN_CUE_DURATION) {
        end = start + MIN_CUE_DURATION;
      }

      return {
        index: i + 1,
        start,
        end,
        text: c.text,
      };
    });

    // Drop cues fully before t=0 (end === 0 from above, or zero-length)
    let kept = raw.filter((c) => c.end > EPS);

    // Sort — required after affine map if scale < 0 were ever allowed;
    // with scale > 0 order is preserved, but we sort anyway for safety.
    kept.sort((a, b) => a.start - b.start || a.end - b.end);

    // Resolve overlaps introduced (or pre-existing) after correction
    kept = this.fixOverlaps(kept);

    // Re-index sequentially for export
    kept = kept.map((c, i) => ({ ...c, index: i + 1 }));

    this.cues = kept;
  }

  /**
   * Ensure non-overlapping cues for deterministic active-set queries and
   * well-formed SRT. Strategy: if cue i overlaps i+1, shrink end of earlier
   * cue to next.start - epsilon; if that would destroy duration, push next.start.
   */
  private fixOverlaps(cues: Cue[]): Cue[] {
    if (cues.length === 0) return cues;
    const out: Cue[] = [{ ...cues[0] }];

    for (let i = 1; i < cues.length; i++) {
      const prev = out[out.length - 1];
      const cur = { ...cues[i] };

      if (cur.start < prev.end - EPS) {
        // Overlap: prefer shortening previous end
        const newPrevEnd = cur.start;
        if (newPrevEnd - prev.start >= MIN_CUE_DURATION) {
          prev.end = Math.max(prev.start + MIN_CUE_DURATION, newPrevEnd);
          // If still overlapping due to floor, shift current
          if (prev.end > cur.start) {
            const shift = prev.end - cur.start;
            cur.start += shift;
            cur.end += shift;
          }
        } else {
          // Previous too short to shrink — shift current forward
          const shift = prev.end - cur.start;
          cur.start += shift;
          cur.end = Math.max(cur.end + shift, cur.start + MIN_CUE_DURATION);
        }
      }

      // Ensure positive duration
      if (cur.end < cur.start + MIN_CUE_DURATION) {
        cur.end = cur.start + MIN_CUE_DURATION;
      }
      out.push(cur);
    }

    // After shifting chain, may cascade overlaps — one more linear pass
    for (let i = 1; i < out.length; i++) {
      if (out[i].start < out[i - 1].end) {
        out[i].start = out[i - 1].end;
        if (out[i].end < out[i].start + MIN_CUE_DURATION) {
          out[i].end = out[i].start + MIN_CUE_DURATION;
        }
      }
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Query: O(log n) getActiveCues
  // -------------------------------------------------------------------------

  /**
   * Return all cues active at videoTime (start <= t < end).
   *
   * After fixOverlaps, at most one cue should be active, but we still support
   * a small active set for robustness if overlaps remain.
   *
   * Algorithm:
   * 1. Binary search rightmost cue with start <= t  (O(log n))
   * 2. Walk left while cue.end > t (and start <= t) — O(k) where k is
   *    local overlap multiplicity, expected 1 after fixOverlaps.
   *
   * Why not break binary search with large drift?
   * - Binary search is on *corrected* start times after affine map + sort.
   * - Affine with scale > 0 is order-preserving on original sorted starts,
   *   so sorted order remains valid. We re-sort after correction anyway.
   * - Drift magnitude does not affect sortedness or log-time search;
   *   only scale <= 0 would reverse order (we reject that).
   */
  getActiveCues(videoTime: number): Cue[] {
    const cues = this.cues;
    const n = cues.length;
    if (n === 0 || !Number.isFinite(videoTime)) return [];

    // Find rightmost index with start <= videoTime
    let lo = 0;
    let hi = n; // exclusive
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= videoTime) lo = mid + 1;
      else hi = mid;
    }
    // lo is first index with start > videoTime; candidates are ... lo-1, lo-2, ...
    const active: Cue[] = [];
    for (let i = lo - 1; i >= 0; i--) {
      const c = cues[i];
      if (c.end <= videoTime) {
        // Entirely in the past. With non-overlapping sorted cues, we can stop.
        // With residual overlaps, continue a bit — but if start is already
        // far before and ends before t, earlier cues end even earlier once
        // sorted by start and non-overlapping.
        // Safe early exit when non-overlapping:
        if (i === lo - 1 || c.end <= videoTime) {
          // If this cue ended before t and starts before previous candidates,
          // further left cues with start <= c.start also end <= c.end <= t
          // only if non-overlapping and ordered. We enforced non-overlap.
          break;
        }
      }
      if (c.start <= videoTime && videoTime < c.end) {
        active.push(c);
      }
      // If we already left the possible window: starts still <= t but we only
      // need cues that cover t. With non-overlap, at most one; break after finding.
      if (active.length > 0) {
        // keep scanning left only if overlaps allowed; our fixOverlaps means 1
        break;
      }
    }

    // If overlapping were retained, scan a small window left of lo for coverage
    // (defensive path when fixOverlaps is disabled by a future flag)
    if (active.length === 0) {
      // nothing covering — ok
    }

    return active.reverse(); // chronological
  }

  /**
   * Alternative multi-active search that does not assume non-overlap.
   * Still O(log n + k) for k actives / local density.
   */
  getActiveCuesAllowOverlap(videoTime: number): Cue[] {
    const cues = this.cues;
    const n = cues.length;
    if (n === 0 || !Number.isFinite(videoTime)) return [];

    // Rightmost start <= t
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= videoTime) lo = mid + 1;
      else hi = mid;
    }

    const active: Cue[] = [];
    for (let i = lo - 1; i >= 0; i--) {
      const c = cues[i];
      // If even the start is such that max possible end in original data is
      // unknown, we only stop when c.start is so early that no reasonable cue
      // duration could cover t. We use a hard max duration (e.g. 30s) OR
      // stop when c.end <= t for consecutive non-covers after first.
      if (c.start > videoTime) continue;
      if (videoTime < c.end) active.push(c);
      // Early-stop heuristic: if this cue ends well before t and starts
      // more than MAX_CUE_SPAN before t, stop. Prevents O(n) on pathological
      // "one giant overlapping pile" after bad anchors.
      const MAX_CUE_SPAN = 120; // seconds
      if (c.end <= videoTime && videoTime - c.start > MAX_CUE_SPAN) break;
    }
    return active.reverse();
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /** Export corrected cues as SRT string (CRLF for Windows player friendliness) */
  exportSRT(options?: { crlf?: boolean; renumber?: boolean }): string {
    const crlf = options?.crlf ?? true;
    const nl = crlf ? "\r\n" : "\n";
    const lines: string[] = [];

    this.cues.forEach((c, i) => {
      const idx = options?.renumber === false ? c.index : i + 1;
      lines.push(String(idx));
      lines.push(
        `${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}`
      );
      lines.push(c.text);
      lines.push(""); // blank line between cues
    });

    return lines.join(nl);
  }

  /** Accessors for UI */
  getCues(): readonly Cue[] {
    return this.cues;
  }

  getOriginalCues(): readonly Cue[] {
    return this.original;
  }

  getCueCount(): number {
    return this.cues.length;
  }
}
