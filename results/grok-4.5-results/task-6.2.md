# Subtitle Sync Correction System

Users load external SRT files that are out of sync with video in three ways:

| Mode | Cause | Transform needed |
|------|--------|------------------|
| (a) Constant offset | Rip vs release timing, different start pads | \( t' = t + b \) |
| (b) Linear drift | Framerate mismatch (e.g. 23.976 vs 25) | \( t' = a \cdot t \) |
| (c) Both | Different source + wrong FPS assumption | \( t' = a \cdot t + b \) |

The correction model is the affine map:

\[
t_{\text{video}} = a \cdot t_{\text{sub}} + b
\]

- \( a \) — scale (rate correction; \( a = 1 \) means pure offset)
- \( b \) — offset in seconds (can be negative)

---

## 1. Math: Anchors → Offset and Scale

### Anchor definition

An **anchor** is a user-marked pair:

\[
(s_i,\; v_i)
\]

where:

- \( s_i \) = subtitle timeline position of a chosen cue (typically cue start, or a word the user identifies)
- \( v_i \) = video time when the user taps “this line is spoken NOW”

We want \( a, b \) such that \( v_i \approx a\, s_i + b \) for all anchors.

---

### Why ONE anchor only fixes (a)

With a single pair \( (s_1, v_1) \):

\[
v_1 = a\, s_1 + b
\]

This is **one equation, two unknowns**. Infinitely many \( (a,b) \) pairs fit.

**Practical choice for one anchor:** assume no drift, fix \( a = 1 \):

\[
b = v_1 - s_1, \qquad t' = t + b
\]

That fully solves constant offset. It cannot distinguish rate error: a line that is early at the start of a long file and late at the end (or vice versa) will still drift after a pure shift.

**Intuition:** shifting the whole file slides every cue by the same amount. Framerate mismatch stretches or compresses the *gaps* between cues; one point cannot measure stretch.

---

### Why TWO anchors fix (b) and (c)

Two anchors \( (s_1,v_1),\ (s_2,v_2) \) with \( s_1 \neq s_2 \):

\[
\begin{aligned}
v_1 &= a\, s_1 + b \\
v_2 &= a\, s_2 + b
\end{aligned}
\]

Subtract:

\[
v_2 - v_1 = a\,(s_2 - s_1)
\quad\Rightarrow\quad
a = \frac{v_2 - v_1}{s_2 - s_1}
\]

Then:

\[
b = v_1 - a\, s_1
\]

(equivalently \( b = v_2 - a\, s_2 \)).

- If the problem was pure offset, \( a \approx 1 \) and \( b \) carries the shift.
- If pure FPS mismatch with aligned origins, \( b \approx 0 \) and \( a \) is the ratio (e.g. \( 25/23.976 \)).
- If both, both coefficients come out nonzero.

**Important:** pick anchors far apart in the file (first vs last act). Conditioning of \( a \) improves with \( |s_2 - s_1| \); near-duplicate times make \( a \) numerically unstable.

**Common FPS ratios for reference:**

\[
\frac{25}{23.976} \approx 1.042709,\quad
\frac{23.976}{25} \approx 0.95904,\quad
\frac{24}{25} = 0.96,\quad
\frac{25}{24} \approx 1.041667,\quad
\frac{24}{23.976} \approx 1.001001,\quad
\frac{30}{29.97} \approx 1.001001
\]

---

### THREE OR MORE anchors: least squares

User error and non-linear residual make exact fit of all points impossible. Use ordinary least squares (OLS) for the model \( v = a\, s + b \).

Given \( n \geq 2 \) anchors \( (s_i, v_i) \):

\[
\begin{aligned}
\bar{s} &= \frac{1}{n}\sum_i s_i, &
\bar{v} &= \frac{1}{n}\sum_i v_i \\[6pt]
a &= \frac{\sum_i (s_i - \bar{s})(v_i - \bar{v})}{\sum_i (s_i - \bar{s})^2} \\[6pt]
b &= \bar{v} - a\, \bar{s}
\end{aligned}
\]

In matrix form, with design matrix \( X \in \mathbb{R}^{n\times 2} \) whose \( i \)-th row is \( [s_i,\ 1] \) and \( \mathbf{v} = (v_1,\ldots,v_n)^\top \):

\[
\begin{bmatrix} a \\ b \end{bmatrix}
=
(X^\top X)^{-1} X^\top \mathbf{v}
\]

**Degenerate case:** if all \( s_i \) equal (or variance of \( s \) is ~0), fall back to pure offset:

\[
a = 1,\quad b = \bar{v} - \bar{s}
\]

**Optional robustness (recommended for 4+ anchors):** after OLS, compute residuals \( r_i = v_i - (a s_i + b) \); drop outliers with \( |r_i| > k \cdot \mathrm{MAD} \) (e.g. \( k = 3 \)) and re-fit. Not required for the core system but useful when users mis-tap.

**Quality metric** (show in UI):

\[
\mathrm{RMSE} = \sqrt{\frac{1}{n}\sum_i r_i^2}
\]

Large RMSE after fit → user anchors inconsistent, or non-linear desync (commercial breaks, multi-part rips) that a single affine map cannot fix.

---

### Applying the map to every cue

For each cue with start \( t_0 \) and end \( t_1 \) on the *subtitle* clock:

\[
\begin{aligned}
t_0' &= a\, t_0 + b \\
t_1' &= a\, t_1 + b
\end{aligned}
\]

Duration scales by \( a \): \( (t_1' - t_0') = a\,(t_1 - t_0) \). That is correct for framerate stretch: spoken duration in video time scales with the rate.

If you only shifted midpoints and kept raw durations, drift-corrected midpoints would still have wrong lengths relative to the video; scaling both endpoints is the right model.

---

## 2. Implementation: `SubtitleSyncer` (TypeScript)

```typescript
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
```

### Notes on `getActiveCues` complexity

- Sorted array by `start`; binary search finds the last cue that could have started → \( O(\log n) \).
- With overlap fixed, walking left is \( O(1) \) (one cue).
- **Drift does not break binary search.** Binary search assumes monotonic order of the search key (`start`), not anything about physical “amount of drift.” After \( t' = a t + b \) with \( a > 0 \), order of starts is preserved; we also re-sort. Large \( |b| \) or \( a \neq 1 \) only changes values, not the validity of dichotomous search.
- What *would* break naive assumptions: \( a < 0 \) (time reversal), or querying on the **uncorrected** array with a corrected time. Both are avoided.

---

## 3. Auto-Detection Bonus: Guess Framerate Mismatch Without Anchors

### Honest client-side constraint

Without speech recognition, forced alignment, or a reference subtitle track, the browser **does not** know when dialogue actually occurs. Available signals are weak:

| Signal | Available client-side? | Useful for FPS guess? |
|--------|------------------------|------------------------|
| SRT cue start/end times & gaps | Yes | Structure only |
| Video duration (`HTMLMediaElement.duration`) | Yes | Compare end of last cue vs video length |
| Video frame rate | Sometimes (`VideoPlaybackQuality` / WebCodecs / container metadata — **not reliably** in plain HTML5) | If known, compare to assumed sub FPS |
| Audio waveform / energy | Yes (Web Audio API) | Crude “speech activity” proxy — **noisy** |
| ASR / forced alignment | No (unless you ship a model / server) | Gold standard, out of scope |
| Burned-in / embedded captions | Rarely | Could compare if present |

So auto-detect without ASR is a **heuristic ranking of discrete hypotheses**, not a precise solver. Be transparent to the user: “Suggested sync — please verify.”

### Candidate ratios

Enumerate a small closed set (scale = video_rate / subtitle_rate interpretation depends on convention; here `scale` multiplies **subtitle** time to get **video** time):

```typescript
const FPS_CANDIDATES: { name: string; scale: number }[] = [
  { name: "identity",           scale: 1 },
  { name: "25 / 23.976",        scale: 25 / 23.976 },
  { name: "23.976 / 25",        scale: 23.976 / 25 },
  { name: "25 / 24",            scale: 25 / 24 },
  { name: "24 / 25",            scale: 24 / 25 },
  { name: "24 / 23.976",        scale: 24 / 23.976 },
  { name: "23.976 / 24",        scale: 23.976 / 24 },
  { name: "30 / 29.97",         scale: 30 / 29.97 },
  { name: "29.97 / 30",         scale: 29.97 / 30 },
  { name: "30 / 25",            scale: 30 / 25 },
  { name: "25 / 30",            scale: 25 / 30 },
  // PAL speedup of film, etc.
  { name: "25 / 23.976 (PAL)",  scale: 25 / (24000 / 1001) },
];
```

For each candidate scale \( a \), we still need offset \( b \). Without anchors, estimate \( b \) by aligning **endpoints** or by a coarse search:

1. **Endpoint fit:**  
   \( b \approx 0 \) if both start at 0, or  
   \( b = 0 - a \cdot s_{\text{first}} \) if first cue should land at video start (weak), or  
   better: grid-search \( b \) over a window (e.g. \([-30, 30]\) s) in 0.1–0.5 s steps.

2. **Duration match:**  
   Let \( T_v \) = video duration, \( T_s \) = last cue end (or last dialogue cluster).  
   Prefer \( a \) such that \( a \cdot T_s + b \approx T_v \) (with small \( b \)).  
   Alone this confuses padding/credits with true rate error.

### Scoring heuristic (no ASR)

**What you score against:** structural agreement between (transformed) subtitle activity and whatever weak temporal signal you have.

#### A. Duration / span score (always available)

\[
\text{score}_{\text{span}} = -\left| (a \cdot s_{\text{last}} + b) - T_v \right|
\]

Also penalize if many cues map past \( T_v \) or before 0.

#### B. Offset grid + “cue density near scene boundaries” (weak)

If you extract shot-change times from decoded frames (Canvas + frame differencing — expensive, optional), score how many cue starts fall within ±0.3 s of a cut. Dialogue often starts just after cuts. **High cost, medium value.**

#### C. Audio energy correlation (best non-ASR client signal)

1. Decode audio via Web Audio API → downsample to ~50–100 Hz energy envelope \( e(t) \) (RMS per hop).
2. Build subtitle activity function \( u(t) \): 1 on \( [t'_0, t'_1] \) for each corrected cue (or soft windows).
3. For each \( (a, b) \) hypothesis, compute normalized cross-correlation or mean energy under active cues:

\[
\text{score}_{\text{audio}} = \frac{\int u_{a,b}(t)\, e(t)\, dt}{\int u_{a,b}(t)\, dt}
\]

Prefer hypotheses where dialogue intervals sit on higher energy than silence intervals (also score silence: mean energy where \( u = 0 \) should be lower).

**Caveats (be honest):**

- Music, SFX, and overlapping speech wreck the correlation.
- Silent dialogue (or whispered) and loud non-speech invert the signal.
- Works better as a **tie-breaker among discrete FPS ratios** than as free continuous optimization.
- Privacy/CPU: analyzing full audio can be heavy; sample first/middle/last 5 minutes.

#### D. Discrete argmax

```text
best = null
for a in CANDIDATE_SCALES:
  for b in OFFSET_GRID:   # or closed-form b from maximizing correlation at fixed a
    s = w1 * spanScore(a,b) + w2 * audioScore(a,b) + w3 * boundsScore(a,b)
    if s > best.s: best = {a,b,s}
if best.s < THRESHOLD:  // refuse auto-apply
  recommend manual anchors
else
  setParams(best) and prompt user to verify with 1–2 taps
```

**Recommended product flow:** auto-detect suggests top-3 \( (a,b) \) presets (“Looks like 25fps sub on 23.976 video, +1.2s”); user confirms or falls back to two-tap anchors. Never silently apply low-confidence results.

### What auto-detect cannot do well

- Constant offset alone when audio energy is flat (AMV, noisy rips)
- Multi-segment files (joined episodes with separate offsets)
- Subs for a different cut (Director’s vs theatrical) — affine model is wrong globally

Those need anchors or ASR alignment.

---

## 4. Edge Cases (and How the Code Handles Them)

### 4.1 Negative times after correction

**Cause:** large negative \( b \), or early cues with \( a t + b < 0 \).

**Handling:**

1. If `end <= 0`: drop cue entirely (off-screen before playback starts).
2. If `start < 0 < end`: clamp `start = 0`, keep text (still partially visible).
3. Export formatter also clamps display times to ≥ 0 so SRT stays legal for picky players.

### 4.2 Cues that overlap after correction

**Cause:** pre-existing SRT overlaps; or (rarely) unequal duration handling; or aggressive clamping.

**Note:** pure affine with \( a > 0 \) **preserves** relative order and does not create new overlaps from non-overlapping input, because both endpoints map monotonically. Overlaps after correction mostly mean **source overlaps** or **post-clamp** artifacts (start clipped to 0 for many early cues).

**Handling:** `fixOverlaps` linear pass:

- Sort by start.
- If `cur.start < prev.end`, shrink `prev.end` to `cur.start` if duration allows; else shift `cur` forward.
- Second pass to clean cascades.
- Enforce `MIN_CUE_DURATION` so cues never collapse to zero.

Trade-off: shortening is preferred over dropping text; shifting can slightly misalign later cues when the source was heavily overlapping — acceptable for display correctness.

### 4.3 “Drift so large binary search breaks”

**Clarification:** binary search does **not** break due to large drift. It breaks only if:

| Failure mode | Mitigation |
|--------------|------------|
| Array not sorted by `start` | Always re-sort after rebuild |
| `scale <= 0` reverses or collapses order | Reject non-positive scale; fall back to pure offset |
| Searching original times with corrected clock | Only query `this.cues` (corrected) |
| Overlaps → multiple actives, naive “one binary hit” | `fixOverlaps` + optional `getActiveCuesAllowOverlap` with span-limited left walk |
| Floating-point equal starts | Sort secondary key by `end`; use `EPS` comparisons |

Large \( |a - 1| \) or \( |b| \) only moves numbers; logarithmic search on a sorted array remains valid.

### 4.4 Additional edge cases covered

| Case | Behavior |
|------|----------|
| BOM / CRLF | `normalizeText` |
| `HH:MM:SS.mmm` vs comma | both accepted |
| Missing index lines | optional index |
| Inverted start/end | swap + warn |
| Zero-length cue | expand to `MIN_CUE_DURATION` |
| Empty text blocks | skip |
| 1 anchor | pure offset |
| Collinear / identical \( s_i \) | pure offset fallback |
| Bad scale from garbage anchors | detect `scale <= 0` or non-finite → average offset |
| Export | sequential indices, legal timestamps, optional CRLF |

### 4.5 Non-linear desync (outside affine model)

If RMSE of 3+ anchors is large, the content may have commercial cuts or multi-part joins. Options (document for product, not fully implemented above):

- Piecewise affine between consecutive anchors (interpolate \( a,b \) per segment) — better UX for multi-cut rips.
- Warn user: “Anchors disagree; try anchors within one continuous segment.”

Piecewise formula between anchors \( i \) and \( i+1 \) (for \( s \in [s_i, s_{i+1}] \)):

\[
a_i = \frac{v_{i+1} - v_i}{s_{i+1} - s_i},\quad
b_i = v_i - a_i s_i,\quad
t' = a_i t + b_i
\]

Outside the outer anchors, extrapolate with the nearest segment’s \( (a_i, b_i) \).

---

## Quick usage example

```typescript
const syncer = new SubtitleSyncer();
syncer.parseSRT(srtFileText);

// User taps: subtitle line at 120.0s is spoken at video 125.5s
//            subtitle line at 3600s is spoken at video 3755.2s
syncer.applyAnchors([
  { subtitleTime: 120.0, videoTime: 125.5 },
  { subtitleTime: 3600.0, videoTime: 3755.2 },
]);
// → scale ≈ (3755.2 - 125.5) / (3600 - 120) ≈ 1.0424  (≈ 25/23.976)
// → offset ≈ 125.5 - scale * 120

// During playback:
video.addEventListener("timeupdate", () => {
  const active = syncer.getActiveCues(video.currentTime);
  render(active);
});

// Save:
const corrected = syncer.exportSRT();
```

---

## Summary

1. **Math:** affine map \( v = a s + b \). One anchor → fix \( a=1 \), solve \( b \). Two anchors → unique \( (a,b) \). Three+ → OLS on the same linear model; report RMSE.
2. **Code:** `SubtitleSyncer` parses messy SRT, fits anchors, rebuilds with clamp/overlap fixes, serves active cues via binary search, exports SRT.
3. **Auto-detect:** try discrete FPS ratios × offset grid; score with video-duration fit and (if willing) audio-energy correlation. No reliable client-side truth without ASR — always confirm with the user.
4. **Edges:** clip/drop negative times, resolve overlaps, keep `scale > 0` and sorted arrays so binary search stays valid regardless of drift magnitude.
