# Subtitle Synchronization System

This document presents a complete solution for correcting out-of-sync external SRT subtitles. It is organized into four sections:
1. **The Math**: Mathematical derivations for 1, 2, and $3+$ anchor points.
2. **Implementation**: A production-grade TypeScript class (`SubtitleSyncer`) implementing parsing, correction, $O(\log n)$ retrieval, and export.
3. **Auto-Detection Bonus Path**: A client-side audio-based scoring heuristic for detecting framerate mismatches.
4. **Edge Cases**: Explanations and programmatic solutions for negative times, overlapping cues, and large drift.

---

## 1. The Math of Anchor Points

Let a user-marked anchor point $A_i$ be defined as a pair $(s_i, v_i)$, where:
- $s_i$ is the timestamp of a line in the subtitle file (in seconds).
- $v_i$ is the timestamp when that line is actually heard in the video (in seconds).

We model the correction function as a linear mapping from subtitle time $s$ to video time $v$:
$$v = m \cdot s + c$$

Where:
- $m$ is the scale factor (slope), representing the speed ratio (drift correction) due to framerate mismatches.
- $c$ is the constant temporal offset (intercept), representing the delay/advance of the subtitles.

---

### Case A: One Anchor Point (Constant Offset Only)
Given a single anchor point $(s_1, v_1)$, the linear equation is:
$$v_1 = m \cdot s_1 + c$$

This is a system of 1 equation and 2 unknowns ($m$ and $c$). It is mathematically underdetermined, meaning there are infinitely many lines passing through $(s_1, v_1)$. 

To solve this, we must assume that there is no linear drift between the video and the subtitles (i.e., they play at the exact same rate), which means $m = 1.0$. Substituting $m = 1.0$:
$$v_1 = 1.0 \cdot s_1 + c \implies c = v_1 - s_1$$

Thus, a single anchor point can only correct for a constant offset (shift).

---

### Case B & C: Two Anchor Points (Constant Offset + Linear Drift)
Given two distinct anchor points $(s_1, v_1)$ and $(s_2, v_2)$ where $s_1 \neq s_2$, we have a system of 2 linear equations:
1) $v_1 = m \cdot s_1 + c$
2) $v_2 = m \cdot s_2 + c$

This is a determined system (2 equations, 2 unknowns). Subtracting equation (1) from (2):
$$v_2 - v_1 = m(s_2 - s_1) \implies m = \frac{v_2 - v_1}{s_2 - s_1}$$

Using the calculated value of $m$, we solve for $c$ using either equation:
$$c = v_1 - m \cdot s_1$$

This uniquely determines the slope $m$ (correcting linear drift) and intercept $c$ (correcting offset).

---

### Case D: Three or More Anchor Points (Least Squares Fit)
When users provide $N \ge 3$ anchor points, the system is overdetermined because human click timing is imperfect (i.e., all points will not lie on a perfect straight line). We use Ordinary Least Squares (OLS) regression to find the parameters $m$ and $c$ that minimize the sum of squared residuals:

$$E(m, c) = \sum_{i=1}^N \left( v_i - (m \cdot s_i + c) \right)^2$$

To find the minimum, we set the partial derivatives of $E$ with respect to $m$ and $c$ to zero:
$$\frac{\partial E}{\partial m} = -2 \sum_{i=1}^N s_i (v_i - m \cdot s_i - c) = 0 \implies m \sum_{i=1}^N s_i^2 + c \sum_{i=1}^N s_i = \sum_{i=1}^N s_i v_i$$
$$\frac{\partial E}{\partial c} = -2 \sum_{i=1}^N (v_i - m \cdot s_i - c) = 0 \implies m \sum_{i=1}^N s_i + N c = \sum_{i=1}^N v_i$$

Let $\bar{s} = \frac{1}{N}\sum_{i=1}^N s_i$ and $\bar{v} = \frac{1}{N}\sum_{i=1}^N v_i$ denote the means of the subtitle and video anchor points, respectively. From the second equation:
$$c = \bar{v} - m \bar{s}$$

Substituting this expression for $c$ back into the first equation:
$$m \sum_{i=1}^N s_i^2 + (\bar{v} - m \bar{s}) \sum_{i=1}^N s_i = \sum_{i=1}^N s_i v_i$$
$$m \left( \sum_{i=1}^N s_i^2 - N \bar{s}^2 \right) = \sum_{i=1}^N s_i v_i - N \bar{s} \bar{v}$$

Using algebraic identities, we solve for $m$:
$$m = \frac{\sum_{i=1}^N (s_i - \bar{s})(v_i - \bar{v})}{\sum_{i=1}^N (s_i - \bar{s})^2}$$

And the optimal constant offset $c$ is:
$$c = \bar{v} - m \bar{s}$$

---

## 2. TypeScript Implementation

Below is the complete, self-contained TypeScript class `SubtitleSyncer`. It implements:
- Parsing SRT with support for BOM, CRLF, varying millisecond precisions, and malformed spacing.
- Linear mapping based on $0$, $1$, $2$, or $3+$ anchors.
- Re-indexing and sorting corrected cues.
- An augmented Interval Search Tree allowing $O(\log n + K)$ lookups of active cues.
- Optional trimming of overlapping cues.

```typescript
export interface SubtitleCue {
  id: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

export interface AnchorPoint {
  subtitleTime: number; // in seconds
  videoTime: number;    // in seconds
}

interface SearchNode {
  cue: SubtitleCue;
  maxEndTime: number; // Maximum end time in the entire subtree
  left: SearchNode | null;
  right: SearchNode | null;
}

export class SubtitleSyncer {
  private originalCues: SubtitleCue[] = [];
  private correctedCues: SubtitleCue[] = [];
  private searchTreeRoot: SearchNode | null = null;

  // Linear equation variables: videoTime = m * subtitleTime + c
  private m: number = 1.0;
  private c: number = 0.0;

  constructor() {}

  /**
   * Parses raw SRT content.
   * Handles BOM, CRLF/LF, loose spacing, periods instead of commas, and missing components.
   */
  public parseSRT(srtContent: string): void {
    // Remove Byte Order Mark (BOM) if present
    let cleanContent = srtContent.replace(/^\uFEFF/, '');
    
    // Normalize line endings to LF
    cleanContent = cleanContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Split by double-newlines (allows for varying blank lines)
    const blocks = cleanContent.split(/\n\n+/);
    
    this.originalCues = [];
    
    for (const block of blocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;
      
      const lines = trimmedBlock.split('\n');
      if (lines.length < 2) continue;
      
      // Locate the timestamp separator line.
      // Usually it's the second line, but we search the first few lines to tolerate malformed blocks.
      let timeLineIndex = -1;
      for (let i = 0; i < Math.min(3, lines.length); i++) {
        if (lines[i].includes('-->')) {
          timeLineIndex = i;
          break;
        }
      }
      
      if (timeLineIndex === -1) continue; // Skip malformed block without timestamp
      
      const id = timeLineIndex > 0 ? lines[0].trim() : String(this.originalCues.length + 1);
      const timeLine = lines[timeLineIndex];
      const text = lines.slice(timeLineIndex + 1).join('\n');
      
      const parsedTimes = this.parseTimeLine(timeLine);
      if (!parsedTimes) continue; // Skip if timestamp formatting is unparseable
      
      this.originalCues.push({
        id,
        startTime: parsedTimes.startTime,
        endTime: parsedTimes.endTime,
        text
      });
    }
    
    this.resetCorrection();
  }

  /**
   * Helper to parse "HH:MM:SS,mmm --> HH:MM:SS,mmm" with variations
   */
  private parseTimeLine(timeLine: string): { startTime: number; endTime: number } | null {
    const parts = timeLine.split('-->');
    if (parts.length !== 2) return null;
    
    const startTime = this.parseTimestamp(parts[0].trim());
    const endTime = this.parseTimestamp(parts[1].trim());
    
    if (startTime === null || endTime === null) return null;
    return { startTime, endTime };
  }

  /**
   * Parses timestamp strings (e.g., "01:23:45,678", "23:45.678", "45.68") into seconds.
   */
  private parseTimestamp(timeStr: string): number | null {
    const normalized = timeStr.replace(',', '.'); // Allow both '.' and ',' decimals
    const parts = normalized.split(':');
    if (parts.length === 0) return null;

    let hours = 0;
    let minutes = 0;
    let secondsWithMs = 0;

    if (parts.length === 3) {
      hours = parseFloat(parts[0]);
      minutes = parseFloat(parts[1]);
      secondsWithMs = parseFloat(parts[2]);
    } else if (parts.length === 2) {
      minutes = parseFloat(parts[0]);
      secondsWithMs = parseFloat(parts[1]);
    } else if (parts.length === 1) {
      secondsWithMs = parseFloat(parts[0]);
    } else {
      return null;
    }

    if (isNaN(hours) || isNaN(minutes) || isNaN(secondsWithMs)) return null;

    return hours * 3600 + minutes * 60 + secondsWithMs;
  }

  private resetCorrection(): void {
    this.correctedCues = this.originalCues.map(c => ({ ...c }));
    this.m = 1.0;
    this.c = 0.0;
    this.rebuildIndex();
  }

  /**
   * Resolves the scaling (m) and offset (c) from anchor points.
   * Handles 0, 1, 2, or N anchors and clamps negative times.
   */
  public applyAnchors(anchors: AnchorPoint[]): void {
    if (anchors.length === 0) {
      this.resetCorrection();
      return;
    }

    if (anchors.length === 1) {
      this.m = 1.0;
      this.c = anchors[0].videoTime - anchors[0].subtitleTime;
    } else if (anchors.length === 2) {
      const [a1, a2] = anchors;
      const denom = a2.subtitleTime - a1.subtitleTime;
      if (Math.abs(denom) < 1e-6) {
        throw new Error("Anchors must have distinct subtitle times.");
      }
      this.m = (a2.videoTime - a1.videoTime) / denom;
      this.c = a1.videoTime - this.m * a1.subtitleTime;
    } else {
      // Ordinary Least Squares (OLS)
      const N = anchors.length;
      let sumS = 0, sumV = 0, sumS2 = 0, sumSV = 0;
      
      for (const a of anchors) {
        sumS += a.subtitleTime;
        sumV += a.videoTime;
        sumS2 += a.subtitleTime * a.subtitleTime;
        sumSV += a.subtitleTime * a.videoTime;
      }
      
      const meanS = sumS / N;
      const meanV = sumV / N;
      
      let num = 0;
      let den = 0;
      for (const a of anchors) {
        num += (a.subtitleTime - meanS) * (a.videoTime - meanV);
        den += (a.subtitleTime - meanS) * (a.subtitleTime - meanS);
      }
      
      if (Math.abs(den) < 1e-9) {
        throw new Error("Least squares calculation failed: subtitle anchor points are identical.");
      }
      
      this.m = num / den;
      this.c = meanV - this.m * meanS;
    }

    // Safety check: a non-positive slope would reverse or halt playback timing
    if (this.m <= 0) {
      throw new Error(`Invalid calibration: derived speed factor m = ${this.m.toFixed(4)} is non-positive.`);
    }

    const corrected: SubtitleCue[] = [];
    for (const cue of this.originalCues) {
      let start = this.m * cue.startTime + this.c;
      let end = this.m * cue.endTime + this.c;

      // Edge case: clamp negative times to 0
      if (start < 0) start = 0;
      if (end < 0) end = 0;

      // Exclude cues that have collapsed or are fully negative
      if (end <= start) continue;

      corrected.push({
        id: cue.id,
        startTime: start,
        endTime: end,
        text: cue.text
      });
    }

    // Sort to ensure BST properties are preserved
    corrected.sort((a, b) => a.startTime - b.startTime);
    this.correctedCues = corrected;
    this.rebuildIndex();
  }

  /**
   * Rebuilds the search index (an augmented Interval Tree implemented as a balanced BST).
   */
  private rebuildIndex(): void {
    if (this.correctedCues.length === 0) {
      this.searchTreeRoot = null;
      return;
    }
    this.searchTreeRoot = this.buildBalancedTree(0, this.correctedCues.length - 1);
  }

  private buildBalancedTree(start: number, end: number): SearchNode | null {
    if (start > end) return null;
    
    const mid = (start + end) >> 1;
    const cue = this.correctedCues[mid];
    
    const left = this.buildBalancedTree(start, mid - 1);
    const right = this.buildBalancedTree(mid + 1, end);
    
    // Augment with maximum endTime in this subtree
    let maxEndTime = cue.endTime;
    if (left && left.maxEndTime > maxEndTime) maxEndTime = left.maxEndTime;
    if (right && right.maxEndTime > maxEndTime) maxEndTime = right.maxEndTime;
    
    return { cue, maxEndTime, left, right };
  }

  /**
   * Retrieve active cues at a specific video time in O(log n + K) where K is overlaps.
   */
  public getActiveCues(videoTime: number): SubtitleCue[] {
    const results: SubtitleCue[] = [];
    this.searchTree(this.searchTreeRoot, videoTime, results);
    return results.sort((a, b) => a.startTime - b.startTime);
  }

  private searchTree(node: SearchNode | null, videoTime: number, results: SubtitleCue[]): void {
    if (!node) return;
    
    // Prune subtree: no cue here has an end time reaching the current video time
    if (node.maxEndTime < videoTime) return;
    
    // Add if current cue overlaps the playhead
    if (node.cue.startTime <= videoTime && node.cue.endTime >= videoTime) {
      results.push(node.cue);
    }
    
    // Left subtree contains earlier start times; must search it.
    this.searchTree(node.left, videoTime, results);
    
    // Only search the right subtree if current node's start time is <= videoTime.
    // Since the tree is sorted on start times, right subtrees will all have start times > videoTime.
    if (node.cue.startTime <= videoTime) {
      this.searchTree(node.right, videoTime, results);
    }
  }

  /**
   * Optional helper to resolve overlapping cues by trimming the preceding cue.
   */
  public resolveOverlaps(): void {
    if (this.correctedCues.length <= 1) return;

    const resolved: SubtitleCue[] = [];
    let prev = { ...this.correctedCues[0] };

    for (let i = 1; i < this.correctedCues.length; i++) {
      const current = { ...this.correctedCues[i] };
      if (prev.endTime > current.startTime) {
        prev.endTime = current.startTime;
      }
      if (prev.endTime > prev.startTime) {
        resolved.push(prev);
      }
      prev = current;
    }
    if (prev.endTime > prev.startTime) {
      resolved.push(prev);
    }

    this.correctedCues = resolved;
    this.rebuildIndex();
  }

  /**
   * Exports corrected cues back to raw SRT string.
   */
  public exportSRT(): string {
    let output = '';
    for (let i = 0; i < this.correctedCues.length; i++) {
      const cue = this.correctedCues[i];
      const timeStr = `${this.formatTime(cue.startTime)} --> ${this.formatTime(cue.endTime)}`;
      output += `${i + 1}\n${timeStr}\n${cue.text}\n\n`;
    }
    return output.trim() + '\n';
  }

  private formatTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const ms = Math.round((totalSeconds % 1) * 1000);
    
    const pad = (n: number, size: number) => n.toString().padStart(size, '0');
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
  }

  public getParameters(): { m: number; c: number } {
    return { m: this.m, c: this.c };
  }
}
```

---

## 3. Auto-Detection Bonus Path (Client-Side)

### The Core Heuristic & Available Signals
In the browser without speech recognition (e.g. Whisper), the only reliable audio source is the **video track's amplitude envelope (audio energy)**. The core biological/structural heuristic is:
> **Subtitle activity (when text is on screen) should strongly correlate with speech/vocal energy (when someone is speaking in the audio track).**

By generating a binary activity mask of the subtitle file and cross-correlating it with the audio track's envelope under various scales ($m$), we can guess both the drift ratio and constant offset.

### Standard Framerate Mismatch Ratios
We construct a discrete set of candidate scale values ($m$) representing shifts between standard video/film speeds:
- **$23.976 \to 25$ fps**: $m = 25 / 23.976216 \approx \mathbf{1.0427}$
- **$25 \to 23.976$ fps**: $m = 23.976216 / 25 \approx \mathbf{0.9590}$
- **$23.976 \to 24$ fps**: $m = 24 / 23.976216 \approx \mathbf{1.0010}$
- **$24 \to 23.976$ fps**: $m = 23.976216 / 24 \approx \mathbf{0.9990}$
- **$24 \to 25$ fps**: $m = 25 / 24 \approx \mathbf{1.0417}$
- **$25 \to 24$ fps**: $m = 24 / 25 \approx \mathbf{0.9600}$
- **No Mismatch**: $m = \mathbf{1.0000}$

---

### Step-by-Step Client-Side Detection Algorithm

1. **Downsample & Decode Audio**:
   - Instead of decoding the entire video (which exceeds browser memory), decode the audio track at a very low sample rate (e.g., $100\text{ Hz}$ or $200\text{ Hz}$) using `OfflineAudioContext`.
   - To optimize speed, we only need to decode and analyze the first $5$ minutes and the last $5$ minutes of the video, where drift discrepancies are most pronounced.

2. **Compute Audio Activity Mask ($A[t]$)**:
   - Calculate the Root Mean Square (RMS) energy in short sliding windows (e.g., $100\text{ms}$).
   - Set $A[t] = 1$ if the RMS exceeds a dynamic silence threshold (speech detected), and $A[t] = 0$ otherwise.

3. **Compute Subtitle Activity Mask ($S[t]$)**:
   - Construct a binary array $S[t]$ where $S[t] = 1$ if time $t$ falls within any subtitle cue interval, and $S[t] = 0$ otherwise.

4. **Compute Cross-Correlation Scores**:
   For each candidate scale factor $m \in \{1.0, 1.0427, 0.9590, 1.0010, 0.9990, 1.0417, 0.9600\}$:
   - Scale the subtitle mask: $S_m[t] = S[t / m]$.
   - Compute the cross-correlation $R_m[c]$ with a sliding offset $c$ (e.g. from $-30$s to $+30$s):
     $$R_m[c] = \sum_{t} S_m[t - c] \cdot A[t]$$
   - Find the peak offset $c_m^* = \arg\max_c R_m[c]$ and the peak score $P_m = R_m[c_m^*]$.
   - *Note*: In the client, this cross-correlation can be calculated extremely quickly using a 1D Fast Fourier Transform (FFT) or a coarse-to-fine sliding window search.

5. **Selection**:
   - The candidate $m$ that produces the highest correlation score $P_m$ is identified as the correct framerate factor, and the corresponding $c_m^*$ is identified as the constant offset.

---

## 4. Edge Cases and Safeguards

### Negative Times after Correction
* **Problem**: An offset shift of $-10\text{s}$ makes early cues begin at negative video times.
* **Code Solution**: In `applyAnchors()`, both start and end times are clamped using `Math.max(0, time)`. If the resulting duration is zero or negative (i.e. the cue was completely shifted into the past), the cue is excluded from the final array.

### Cues that Now Overlap
* **Problem**: Stretching, shifting, or manual correction might cause cue times to overlap.
* **Code Solution**: The class provides a `resolveOverlaps()` method. It scans sorted cues and trims the `endTime` of a preceding cue to match the `startTime` of the succeeding cue, removing any degenerate cues that collapse to a length of zero.

### Drift so Large that Binary Search Assumptions Break
* **Problem**: Standard binary searches assume the array remains strictly sorted. Under extreme linear scaling, order could reverse or break.
* **Code Solution**:
  1. **Monotonicity Check**: We require $m > 0$. A negative $m$ would mean the subtitles play backwards, which is rejected immediately by throwing an error.
  2. **Explicit Sorting**: After correction, `corrected.sort((a, b) => a.startTime - b.startTime)` runs before indexing or tree assembly. This guarantees the cues are sorted regardless of scaling anomalies.
  3. **Augmented BST**: The `getActiveCues` implementation does not rely on a simple binary search (which can fail on overlapping intervals). It uses an **Augmented Interval Tree** where each node stores the maximum `endTime` of its subtree. This allows robust, mathematically proven $O(\log n + K)$ lookup even if intervals overlap heavily or have extreme lengths.
