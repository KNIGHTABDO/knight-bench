# Subtitle Sync Correction System

## 1. The math

We need a mapping from original subtitle cue time `s` to video time `v`.

Use an affine correction:

```text
v = a + b * s
```

Where:

```text
a = offset, in seconds
b = scale / drift factor
```

After correction, every subtitle timestamp is transformed as:

```text
correctedTime = a + b * subtitleTime
```

Equivalently, if you prefer to store a user-facing offset plus a scale around zero:

```text
correctedTime = offset + scale * subtitleTime
```

These are the same model.

### One anchor: constant offset only

A user anchor is a pair:

```ts
{ subtitleTime: s1, videoTime: v1 }
```

Meaning: the subtitle line whose original timestamp is `s1` is actually being spoken at video time `v1`.

With one anchor, the affine equation is:

```text
v1 = a + b * s1
```

There are two unknowns, `a` and `b`, but only one equation. Infinitely many `(a, b)` pairs satisfy it.

So with one anchor, we must assume no drift:

```text
b = 1
```

Then:

```text
a = v1 - s1
```

Correction:

```text
correctedTime = subtitleTime + (v1 - s1)
```

This fixes case (a): constant offset. It cannot distinguish between a subtitle that is simply 2 seconds late everywhere and a subtitle whose error grows over time because of framerate drift.

### Two anchors: offset plus linear drift

With two anchors:

```text
(s1, v1)
(s2, v2)
```

We have:

```text
v1 = a + b * s1
v2 = a + b * s2
```

Subtract the first equation from the second:

```text
v2 - v1 = b * (s2 - s1)
```

So:

```text
b = (v2 - v1) / (s2 - s1)
```

Then:

```text
a = v1 - b * s1
```

Correction:

```text
correctedTime = a + b * subtitleTime
```

This fixes:

- constant offset, because `a` shifts the line globally;
- linear drift, because `b` stretches or compresses the subtitle timeline;
- both at once, because the affine model contains both terms.

Example: if a subtitle file was timed for 25 fps but the video is 23.976 fps, the subtitle timeline may need to be stretched by approximately:

```text
25 / 23.976 ~= 1.042709
```

If a line originally at 1000 seconds should happen around 1042.7 seconds, that is drift. A constant offset cannot fix that at both the beginning and the end.

### Three or more anchors: least squares

With `n >= 3` anchors, user taps may be noisy. The selected subtitle line may not correspond exactly to the spoken instant, the user may tap a little late, or the cue start may precede the actual syllable.

We still fit:

```text
v_i = a + b * s_i + error_i
```

Choose `a` and `b` minimizing the squared error:

```text
minimize sum_i (a + b * s_i - v_i)^2
```

Let:

```text
meanS = average(s_i)
meanV = average(v_i)
```

Then the ordinary least squares solution is:

```text
b = sum_i ((s_i - meanS) * (v_i - meanV))
    / sum_i ((s_i - meanS)^2)

 a = meanV - b * meanS
```

If the denominator is zero, all anchors have the same subtitle time, so scale is unidentifiable. In that case, fall back to a constant offset using the average offset:

```text
b = 1
 a = average(v_i - s_i)
```

A robust production implementation may additionally reject outliers. For example, fit once, compute residuals:

```text
residual_i = a + b * s_i - v_i
```

Then refit after removing anchors whose absolute residual is far larger than the median absolute deviation. That is optional; plain least squares is the baseline requested here.

---

## 2. Implementation

Below is a self-contained TypeScript implementation.

Design choices:

- Parses UTF-8 text with optional BOM.
- Accepts CRLF, LF, and CR newlines.
- Accepts normal SRT timestamps: `HH:MM:SS,mmm`.
- Also accepts `HH:MM:SS.mmm` as a tolerant extension.
- Rejects malformed cue blocks instead of throwing by default.
- Preserves cue text, but exports regenerated numbering and timestamps.
- Corrects all cue start/end times with the same affine transform.
- Clamps negative corrected times to zero for export and search.
- Handles zero-duration or reversed cues by forcing `end >= start`.
- Handles overlapping cues by keeping them. Overlap is legal in many subtitle renderers. `getActiveCues` returns all cues active at a given time.
- Uses binary search in `O(log n + k)` where `k` is the number of active/nearby overlapping cues returned.
- Re-sorts cues after correction so binary search remains valid even if a negative clamp or bad input changed ordering.

```ts
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
```

### Notes on malformed input and overlaps

Malformed timestamps are skipped. A production UI should report how many cues were skipped, but playback should not fail because of one bad block.

Overlapping cues are not automatically merged or shifted. Overlap can be intentional, for example two speakers, captions plus signs, or karaoke-style captions. The class preserves overlap and returns all active cues.

If the application has a strict renderer that cannot display overlaps, that should be a separate policy layer. Possible policies:

```text
preserve: keep overlaps exactly
stack: render overlapping cues on separate visual rows
shift: move a later cue forward to start after the previous cue ends
truncate: shorten previous cue to end at the next cue start
```

For synchronization, `preserve` is the safest default because it does not destroy timing information.

---

## 3. Auto-detection bonus path

Without user anchors, there is no fully reliable way to infer subtitle drift from SRT text alone. The SRT file contains text and timestamps, but not the video release timing, audio waveform, speech boundaries, or true utterance times.

A browser/client can sometimes access:

- video duration, if metadata is loaded;
- current playback time;
- subtitle cue times and text;
- possibly audio samples only if CORS, DRM, and browser APIs allow it;
- no speech transcript unless speech recognition or server-side processing is added.

So an honest no-speech-recognition heuristic can only guess.

### Common scale ratios to try

The correction model is:

```text
corrected = offset + scale * subtitleTime
```

Common candidates:

```text
1.0                         no drift
25 / 23.976  ~= 1.042709    PAL subtitles on 23.976 fps video; stretch subtitles
23.976 / 25  ~= 0.959040    23.976 subtitles on PAL-speed video; compress subtitles
25 / 24      ~= 1.041667
24 / 25      = 0.96
24 / 23.976  ~= 1.001001
23.976 / 24  ~= 0.999000
30 / 29.97   ~= 1.001001
29.97 / 30   ~= 0.999000
25 / 29.97   ~= 0.834168
29.97 / 25   ~= 1.198800
```

The most common real-world subtitle drift cases are around `25 <-> 23.976`, `25 <-> 24`, and occasionally `24 <-> 23.976`. Ratios around `29.97` are possible but less often the right fix for movie subtitles.

### Heuristic using video duration

If the video duration is known, score each candidate scale by how plausible the corrected subtitle range is.

Let:

```text
first = first subtitle start
last = last subtitle end
D = video duration
scale = candidate scale
```

For each scale, estimate an offset. With no anchors, offset is also unknown. A crude estimate is to align the end of the subtitle file near the end of the video while allowing a small tail margin:

```text
offset = D - scale * last - expectedTail
```

Where `expectedTail` might be 1 to 5 seconds, or estimated from the original subtitle file.

Then compute:

```text
correctedFirst = offset + scale * first
correctedLast = offset + scale * last
```

Score penalties:

```text
penaltyBeforeStart = max(0, -correctedFirst)
penaltyAfterEnd = max(0, correctedLast - D)
penaltyHugeLeadIn = max(0, correctedFirst - plausibleOpeningGap)
penaltyHugeTail = max(0, D - correctedLast - plausibleEndingGap)
```

A simple score:

```text
score =
  10 * penaltyBeforeStart^2 +
  10 * penaltyAfterEnd^2 +
  1  * penaltyHugeLeadIn^2 +
  1  * penaltyHugeTail^2 +
  priorPenalty(scale)
```

Where `priorPenalty(scale)` prefers common ratios over exotic ones.

This can catch cases where a subtitle file ends several minutes before or after the video because of PAL speedup, but it is weak. Some videos have credits, previews, recaps, intros, after-credit scenes, or subtitle files that intentionally do not cover all audio.

### Heuristic using audio energy, not speech recognition

If the client can read audio samples through Web Audio, another heuristic is to compare subtitle cue density to audio activity.

For each candidate `(offset, scale)`:

1. Correct every subtitle cue time.
2. Compute an audio activity curve from the video: short-window RMS energy, spectral flux, or voice-band energy around roughly 300 Hz to 3400 Hz.
3. Score whether subtitle intervals overlap regions with likely speech-like activity.
4. Penalize subtitle intervals that fall in silence.
5. Penalize high speech-like activity regions with no nearby subtitle if the subtitle file is supposed to be complete.

Example score:

```text
score =
  sum over cues averageSpeechEnergy(correctedStart, correctedEnd)
  - lambda1 * subtitleDuringSilencePenalty
  - lambda2 * outOfBoundsPenalty
  - lambda3 * excessiveOverlapPenalty
```

Then search:

```text
for scale in commonRatios:
  for offset in offsets from -120s to +120s, step 0.25s:
    score(scale, offset)
choose best
```

This still does not know what words are spoken. It only guesses that subtitles usually coincide with speech-like audio. It can fail for music, narration over music, quiet dialogue, sound effects, hardcoded foreign-language segments, or videos with burned-in captions.

### Heuristic using browser TextTrack comparison

If the video already has an embedded subtitle or caption track in the correct timing, compare text similarity between the external SRT and the embedded track.

For candidate `(offset, scale)`:

1. Correct external cue times.
2. For each external cue, find embedded cues near that corrected time.
3. Score token similarity: normalized Levenshtein, Jaccard similarity, or cosine similarity over normalized words.
4. Prefer candidates with high text similarity at low time deltas.

This is much stronger, but it requires an existing correctly timed track. Without that, the signal is unavailable.

### Honest conclusion

Without anchors, speech recognition, readable audio, or a known-good comparison track, automatic framerate detection is only a duration/plausibility guess. The UI should present it as:

```text
"Possible 25 fps -> 23.976 fps drift detected. Apply suggested fix?"
```

Not as a certain correction.

---

## 4. Edge cases and how the code handles them

### Negative times after correction

A large negative offset can push early cues before zero.

Code behavior:

```ts
correctedStart = Math.max(0, correctedStart);
correctedEnd = Math.max(0, correctedEnd);
```

This is necessary because SRT cannot represent negative timestamps. If clamping makes a cue zero-duration, it remains valid but will not display for a meaningful interval. A UI may optionally drop zero-duration cues on export.

Alternative policy: preserve negative times internally and only clamp on export. That is useful for editors, but for playback `0` is usually the practical minimum.

### Cues that overlap after correction

Affine transforms with positive scale preserve relative ordering and preserve overlap relationships. However, clamping negative times to zero can create new overlaps at the beginning, and malformed input may already overlap.

Code behavior:

- preserves overlaps;
- sorts by corrected start time;
- builds a prefix maximum of cue end times;
- returns all active overlapping cues from `getActiveCues`.

This avoids losing information. Rendering policy remains separate.

### Drift so large that binary search assumptions break

Binary search requires cues sorted by corrected start time. The dangerous cases are:

- negative scale, which reverses time;
- zero scale, which collapses all cue starts;
- NaN or Infinity from bad anchors;
- correction followed by clamping many cues to zero.

Code behavior:

- rejects non-finite anchors;
- rejects `scale <= 0` by falling back to offset-only correction;
- clamps non-finite corrected times;
- re-sorts after every correction;
- rebuilds the prefix maximum index after every correction.

So binary search still operates on a sorted array.

If many cues start at `0` after clamping, `getActiveCues(0)` may need to scan many active or candidate cues. That is unavoidable because the output itself may be large. The method is `O(log n + k)` for ordinary cue distributions and degrades gracefully when thousands of cues genuinely overlap at the same time.

### Duplicate or bad anchors

If two anchors have identical `subtitleTime`, the scale denominator is zero:

```text
s2 - s1 = 0
```

The code falls back to offset-only correction using the average observed offset.

For 3+ anchors, if all subtitle times are identical, the least-squares denominator is also zero. The code uses the same fallback.

### Rounding exported times

SRT stores milliseconds. The implementation rounds to the nearest millisecond:

```ts
Math.round(seconds * 1000)
```

Rounding avoids a systematic early bias that truncation would introduce.

### Malformed SRT blocks

The parser skips blocks whose timing line cannot be parsed. It accepts:

```text
00:01:02,345 --> 00:01:04,000
00:01:02.345 --> 00:01:04.000
```

It rejects impossible values such as:

```text
00:99:02,000 --> 00:01:04,000
00:01:99,000 --> 00:01:04,000
not a timestamp
```

Skipping malformed cues keeps the player functional. A production app should expose parse warnings so the user knows the file was imperfect.

### Overlapping active cue lookup

A naive binary search can find one cue, but subtitles may overlap. This implementation uses:

```text
cues sorted by start
endPrefixMax[i] = max end among cues[0..i]
```

At query time:

1. Binary search for the first cue whose start is greater than `videoTime`.
2. Scan left.
3. Stop when `endPrefixMax[i] < videoTime`, because no cue at or before `i` can still be active.

This preserves `O(log n)` search behavior plus the cost of returning actual overlaps.