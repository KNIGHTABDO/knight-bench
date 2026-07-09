# Subtitle Sync Correction System

## 1. The Math

### Model

We model the relationship between "subtitle time" (the timestamps baked into the SRT file, `t_sub`) and "video time" (actual playback position, `t_vid`) as an affine (linear) transform:

```
t_vid = a * t_sub + b
```

- `a` (scale) corrects **linear drift** — framerate mismatch. If the subtitle was authored against a video running at a different frame rate than the one the user has, every timestamp is stretched or compressed by a constant ratio.
- `b` (offset) corrects a **constant shift** — e.g., a rip that trims 4 seconds of intro logo, or a different release with a few seconds of extra padding at the start.

An anchor is a pair `(subtitleTime, videoTime)` the user provides by tapping "this line is being spoken now" while a specific subtitle cue is (nominally) active. Each anchor gives us one linear equation in the two unknowns `a` and `b`:

```
videoTime_i = a * subtitleTime_i + b
```

### One anchor — only fixes offset (a)

With a single anchor `(s1, v1)` we have one equation and two unknowns:

```
v1 = a*s1 + b
```

This is underdetermined for `a` — infinitely many `(a, b)` pairs satisfy it. The only way to get a unique, useful correction from one point is to **assume `a = 1`** (no drift, only a shift) and solve for `b`:

```
a = 1
b = v1 - s1
```

That's why a single anchor can only correct a constant offset: you have to fix `a` a priori because there's no second data point to pin down the slope. If there actually IS drift, a one-anchor "fix" will be exactly right at that one point and increasingly wrong the farther you get from it — which is diagnostic of using too few anchors.

### Two anchors — solve for both a and b

With two anchors `(s1, v1)` and `(s2, v2)`, `s1 ≠ s2`, we have two equations, two unknowns — a determined linear system:

```
v1 = a*s1 + b
v2 = a*s2 + b
```

Subtract:

```
v2 - v1 = a*(s2 - s1)
a = (v2 - v1) / (s2 - s1)
b = v1 - a*s1        (or equivalently b = v2 - a*s2)
```

This is exactly two points determining a line. `a` captures the framerate ratio (e.g., `a ≈ 25/23.976 ≈ 1.0427` if subtitles were timed for 25fps content but the video is 23.976fps), and `b` captures whatever residual constant offset remains after removing drift. This single formula handles case (a), (b), and (c) from the prompt uniformly — a pure offset is just the special case `a = 1`, and pure drift is the special case `b ≈ 0` (or more precisely `b` such that the line passes near the origin).

Practical note: pick anchors far apart in time (near the start and near the end of the video). The scale estimate `a` is a ratio of differences; if `s2 - s1` is small, any timing error in the user's taps gets amplified. Anchor separation is the single biggest lever on estimate quality.

### Three or more anchors — least squares

With 3+ anchors the system is overdetermined — more equations than unknowns — and won't have an exact solution because user taps have reaction-time jitter (typically 100-400ms of human latency and inconsistency). We instead find the `(a, b)` that minimizes total squared error between predicted and observed video times. This is ordinary least-squares linear regression of `v` on `s`.

Given n anchors `(s_i, v_i)`:

```
Minimize: E(a,b) = Σ (v_i - (a*s_i + b))^2
```

Take partial derivatives, set to zero:

```
∂E/∂b = -2 Σ (v_i - a*s_i - b) = 0
∂E/∂a = -2 Σ s_i*(v_i - a*s_i - b) = 0
```

This yields the normal equations:

```
Σv_i = a*Σs_i + n*b
Σ(s_i*v_i) = a*Σ(s_i^2) + b*Σs_i
```

Solving in closed form (the standard simple-linear-regression estimator):

```
s̄ = (1/n) Σ s_i
v̄ = (1/n) Σ v_i

a = Σ (s_i - s̄)(v_i - v̄)  /  Σ (s_i - s̄)^2
b = v̄ - a*s̄
```

This is numerically the same as: covariance(s, v) / variance(s), then back out the intercept from the means. Degenerate case: if all `s_i` are equal (zero variance), the denominator is zero — division by zero — and we must fall back to the anchor-count-1 offset-only path (or reject the anchor set and ask the user to spread taps out).

Least squares is the right tool here because it (a) has a closed form — no iterative solver needed for a 2-parameter linear fit, (b) is the maximum-likelihood estimator under the reasonable assumption that tap-timing errors are roughly Gaussian and independent, and (c) naturally "averages out" jitter — more anchors converge toward the true `(a,b)` rather than just picking two of them.

---

## 2. Implementation: `SubtitleSyncer`

```typescript
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
```

Notes on the design:

- Internally everything is stored in **milliseconds as integers/floats derived from the original, uncorrected SRT**. The transform `(a, b)` is applied lazily wherever a corrected time is needed. This means `applyAnchors` can be called repeatedly (e.g., user adjusts anchors, or adds a third anchor to refine) without compounding error from re-applying a transform to already-transformed data — a common bug where each correction pass multiplies the drift.
- `rebuildIndex()` is O(n log n) and runs once per parse or per `applyAnchors` call, not per query — `getActiveCues` itself is O(log n) plus a bounded local scan.
- The binary search finds the rightmost cue whose corrected start is `<= videoTime`, then scans backward only as far as `MAX_LOOKBACK_MS`, addressing the "binary search assumptions break under large drift/overlap" edge case from section 4.

---

## 3. Auto-Detection (Bonus): Guessing Framerate Mismatch Without Anchors

### What signal is actually available client-side

Being honest about constraints: without server-side processing or on-device speech recognition, the browser/app has no access to *what is being said* in the video. So we cannot correlate subtitle text to spoken words. The only signal available client-side is **timing structure** — the sequence of cue start/end times in the SRT itself — correlated against:

1. **Scene-cut / shot-boundary timestamps**, if extractable cheaply (e.g., via `<video>` + `canvas` frame-differencing at coarse intervals, or via existing keyframe/chapter metadata). This is the most honest "signal" available without ASR: dialogue-heavy subtitle cues often cluster near cuts in edited content, but this is a weak, noisy correlation, not a reliable one — many cues have no associated cut, and many cuts have no dialogue.
2. **Cue density / silence-gap patterns** compared against an audio-loudness envelope computed client-side via the Web Audio API (`AnalyserNode` on the `<video>` element). This is far more honest and available signal than scene cuts: we can compute an RMS/energy-over-time curve of the audio track without any ASR, and subtitle cue on/off boundaries *should* roughly align with speech-present/speech-absent regions in that envelope. This gets us actual acoustic ground truth without transcribing anything.
3. **The SRT's own internal timing metadata**, if present (e.g., a container or player reports the video's native frame rate, and the SRT was clearly frame-quantized to a *different* rate — visible as timestamps landing suspiciously close to multiples of 1/23.976s vs 1/25s vs 1/29.97s). This is a strong, purely-structural signal requiring no audio/video decoding at all.

### Approach A — Structural/frame-quantization fingerprinting (cheap, no decoding)

Many SRTs are generated by converting from a frame-based subtitle format (e.g., from a DVD or from a different frame-accurate source) and thus their timestamps are frame-quantized to the *authoring* frame rate, even though SRT itself stores time in ms. We can test each candidate authoring rate `r` in a small enumerated set:

```
candidates = [23.976, 24, 25, 29.97, 30, 50, 59.94]
```

For each candidate `r`, compute how close each cue's start/end time is to the nearest frame boundary at that rate:

```
frameMs(r) = 1000 / r
residual(t, r) = min( t mod frameMs(r), frameMs(r) - (t mod frameMs(r)) )
```

Score each candidate by the mean (or median, more robust to outliers) residual across all cues; the candidate with the lowest mean residual is the most likely authoring frame rate. Then, given the player/video's *actual* frame rate `r_video` (available from `video.getVideoPlaybackQuality()` heuristics, container metadata, or user-supplied), the guessed scale is:

```
a_guess = r_video / r_authoring
```

This works well specifically because frame-rate-mismatch subtitles are *by definition* quantized to the wrong rate — it's a real, exploitable structural fact, not a guess about content. Its weakness: many modern SRTs are hand-timed or converted through tools that don't preserve frame quantization (rounded to whole ms, or drifted through multiple conversions), in which case residuals are noisy for every candidate and this signal is inconclusive — should report low confidence rather than force a guess.

### Approach B — Audio-envelope cross-correlation (works even without frame quantization)

1. Decode the video's audio track client-side (Web Audio API `OfflineAudioContext` or `AnalyserNode` sampled over time) into a coarse loudness/energy time series, e.g., RMS every 100ms — cheap, no ASR involved, purely amplitude-based.
2. Build a matching synthetic step-function series from the subtitle cues: 1 where a cue is active, 0 where not, sampled at the same 100ms resolution.
3. For each candidate `(a, b)` in a small search grid — `a` from the enumerated framerate ratios `{25/23.976, 23.976/25, 24/25, 25/24, 1, 24/23.976, 23.976/24, ...}` and `b` swept over a plausible offset range (e.g., -30s to +30s in 100ms steps) — apply the transform to the subtitle-activity series and compute cross-correlation (or simpler: percentage of subtitle-active samples that fall within audio-energy-above-threshold windows) against the audio envelope.
4. The `(a, b)` combination that maximizes correlation is the best guess.

This is essentially a coarse, amplitude-only alignment — not transcription — so it's honest about being a heuristic: dialogue timing correlates with amplitude envelope, but so does music, ambient noise, and sound effects, so this is a noisy proxy, not a precise one. It works best as a **narrowing filter** (pick the most likely one or two of the ~6 candidate ratios and a rough offset bucket) that then gets **confirmed or refined by asking the user for one or two anchor taps** rather than fully automating correction. That combination — cheap heuristic proposes, cheap user confirmation disambiguates — is the honest, practical design: full automatic correction without any user input or without real ASR is not reliable enough to apply silently.

### Common ratio table used as the candidate set

| Mismatch | Ratio `a` |
|---|---|
| 25 fps subs on 23.976 fps video | 25/23.976 ≈ 1.04270 |
| 23.976 fps subs on 25 fps video | 23.976/25 ≈ 0.95904 |
| 24 fps subs on 25 fps video (PAL speedup) | 24/25 = 0.96000 |
| 25 fps subs on 24 fps video | 25/24 ≈ 1.04167 |
| 24 fps subs on 23.976 fps video | 24/23.976 ≈ 1.00100 |
| 23.976 fps subs on 24 fps video | 23.976/24 ≈ 0.99900 |
| 29.97 fps subs on 25 fps video | 29.97/25 = 1.1988 |
| 25 fps subs on 29.97 fps video | 25/29.97 ≈ 0.83417 |

### Recommendation, stated plainly

Client-side auto-detection without ASR can realistically narrow the problem to "probably one of these 2-3 ratios and roughly this offset bucket," using frame-quantization residuals (cheap, structural, decently reliable when present) and/or audio-envelope correlation (more universally available, noisier). It should **not** be presented to the user as a confident automatic fix — it should pre-select the most likely option in a UI ("Looks like a 25→23.976 fps mismatch — apply?") and still let/encourage the user to drop 1-2 confirming anchors, because the acoustic/structural signal alone is genuinely not strong enough to guarantee correctness, and I want to be explicit that this is a heuristic proposal, not a verified computation.

---

## 4. Edge Cases

### 4a. Negative times after correction

A large negative `b`, or a scale `a < 1` combined with certain offsets, can push a cue's corrected `startMs` below zero (e.g., correcting for a rip that had 8s trimmed from the front, applied to a cue originally at t=3s). Handled in `resolveEdgeCases()`:
- If the cue's corrected `endMs <= 0`, the cue can never be displayed — it's dropped entirely.
- Otherwise, `startMs` is clamped to 0 and `endMs` is preserved (or bumped to `MIN_DURATION_MS` if the clamp collapsed the duration), so the line still appears, just cut short instead of causing a negative timestamp in the exported SRT (which most players either reject or mishandle).

### 4b. Cues that now overlap post-correction

Scale correction changes the *spacing* between cues, not just their position — if `a < 1` (compressing), cues that had comfortable gaps in the original can end up overlapping after correction, especially for tightly-timed cues (fast dialogue). Handled in `resolveEdgeCases()`:
- Cues are processed in corrected-start order; each new cue's start is compared to the *already finalized* end of the previous kept cue.
- If overlap is small enough that trimming the previous cue's end still leaves it a minimum visible duration (`MIN_DURATION_MS`), we trim it — dialogue displayed slightly shorter is preferable to two lines fighting for the same screen time in most single-line-at-a-time UIs.
- If trimming would collapse the previous cue below the minimum duration, we leave the overlap in place rather than destroying a line — `getActiveCues()` already supports returning multiple simultaneously active cues, so downstream rendering (stacked subtitle lines) handles this gracefully rather than the export step silently deleting dialogue.
- This is a deliberate trade-off documented in code: never silently drop text to resolve overlap; only ever trim duration, and only when a floor is respected.

### 4c. Drift large enough that binary-search assumptions break

`getActiveCues()`'s binary search assumes `sortedStarts` is sorted — true by construction since we sort by *corrected* start time in `rebuildIndex()`, so the search itself is always structurally valid regardless of drift magnitude. The subtler break is in the **backward linear scan for overlap**: with extreme scale correction (e.g., `a` far from 1, such as a bad multi-ratio compounding bug, or legitimately extreme drift on a very long file), cue durations can be stretched enormously, meaning the naive "scan backward until start time is out of range" could, in pathological cases, scan very far back — degrading toward O(n) per query on adversarial input.

Mitigation implemented in `getActiveCues()`:
- `MAX_LOOKBACK_MS` bounds the backward scan to a fixed, realistic ceiling (20s) — no legitimate single subtitle cue is ever meaningfully longer than that, even after correction, so this bound is both a correctness-preserving assumption (real subtitle cues) and a performance guard.
- The scale sanity clamp in `applyAnchors()` (`A_MIN = 0.5, A_MAX = 2.0`) additionally prevents `a` itself from reaching absurd magnitudes from a single bad anchor pair (e.g., two anchors placed almost on top of each other, dividing by a near-zero `Δs` and producing a huge or tiny `a`) — this protects both the correction quality and the downstream query performance from a single bad input.
- If a legitimate use case ever requires cues longer than 20s (unusual, but e.g. karaoke-style block captions), `MAX_LOOKBACK_MS` should be a configurable constructor parameter rather than hardcoded — noted as a known limitation of this implementation, not something I've built in, since the prompt's realistic use case is dialogue subtitles.

### Honesty about residual uncertainty

I have not benchmarked the exact false-positive/false-negative rate of the audio-envelope heuristic in section 3, nor validated the `MAX_LOOKBACK_MS = 20000` constant against a real-world corpus of subtitle files — it's a reasonable engineering estimate (typical block-caption cues rarely exceed a few seconds; 20s is a generous safety margin) rather than a measured figure, and should be tuned against real data before shipping.
