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
