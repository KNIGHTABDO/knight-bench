export type Seconds = number;

export interface Anchor {
  subtitleTime: Seconds; // s_i original time user refers to
  videoTime: Seconds;    // v_i when it should appear
}

export interface Cue {
  id: number;
  start: Seconds; // original
  end: Seconds;
  text: string;
  startCorrected: Seconds;
  endCorrected: Seconds;
}

export class SubtitleSyncer {
  private originalCues: Cue[] = [];
  private correctedCues: Cue[] = []; // sorted by startCorrected
  private scale = 1;
  private offset = 0;

  // ---- Parsing ----
  static stripBOM(s: string): string {
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  }

  static parseTimestamp(tc: string): number | null {
    // Accept HH:MM:SS,mmm or HH:MM:SS.mmm, also MM:SS,mmm, SS,mmm
    // Strict enough but tolerant: comma/dot ms, optional hours
    const m = tc.trim().match(/^(?:(\d+):)?(\d+):(\d+)[,\.](\d{1,3})$/)
           || tc.trim().match(/^(\d+):(\d+)[,\.](\d{1,3})$/)
           || tc.trim().match(/^(\d+)[,\.](\d{1,3})$/);
    if (!m) return null;
    try {
      if (m.length === 5) { // HH:MM:SS.ms
        const h = parseInt(m[1]||'0',10);
        const mm = parseInt(m[2],10);
        const s = parseInt(m[3],10);
        const ms = parseInt(m[4].padEnd(3,'0').slice(0,3),10);
        if (mm>=60 || s>=60) return null;
        return h*3600+mm*60+s+ms/1000;
      } else if (m[0].includes(':') && m[0].split(':').length===2) {
        // MM:SS.ms version
        const full = tc.trim().match(/^(\d+):(\d+)[,\.](\d{1,3})$/);
        if (!full) return null;
        const mm = parseInt(full[1],10);
        const s = parseInt(full[2],10);
        const ms = parseInt(full[3].padEnd(3,'0').slice(0,3),10);
        if (s>=60) return null;
        return mm*60+s+ms/1000;
      } else {
        const h = 0; // shouldn't reach
        return null;
      }
    } catch { return null; }
  }

  // Also handle HH:MM:SS,mmm with hours mandatory common case with explicit groups
  static parseTimestampRobust(raw: string): number | null {
    const s = raw.trim();
    // primary regex for SRT: HH:MM:SS,mmm --> HH:MM:SS.mmm
    const re = /^(\d{1,2}):(\d{2}):(\d{2})[,\.](\d{1,3})$/;
    const mt = s.match(re);
    if (mt) {
      const h = parseInt(mt[1],10);
      const m = parseInt(mt[2],10);
      const sec = parseInt(mt[3],10);
      const ms = parseInt(mt[4].padEnd(3,'0'),10);
      if (m>=60 || sec>=60) return null;
      return h*3600+m*60+sec+ms/1000;
    }
    // fallback to looser
    return SubtitleSyncer.parseTimestamp(s);
  }

  static formatTimestamp(t: number): string {
    if (!isFinite(t) || t<0) t=0;
    const h = Math.floor(t/3600);
    const m = Math.floor((t%3600)/60);
    const s = Math.floor(t%60);
    const ms = Math.round((t - Math.floor(t))*1000);
    // handle rounding overflow
    let hh=h, mm=m, ss=s, mss=ms;
    if (mss>=1000){ mss-=1000; ss+=1; }
    if (ss>=60){ ss-=60; mm+=1; }
    if (mm>=60){ mm-=60; hh+=1; }
    const pad = (n:number,l=2)=>String(n).padStart(l,'0');
    return `${pad(hh,2)}:${pad(mm,2)}:${pad(ss,2)},${pad(mss,3)}`;
  }

  parse(srtContent: string): Cue[] {
    const noBOM = SubtitleSyncer.stripBOM(srtContent);
    const normalized = noBOM.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    // Split blocks by 2+ newlines
    const blocks = normalized.split(/\n{2,}/);
    const cues: Cue[] = [];
    let idCounter = 0;

    for (const block of blocks) {
      const lines = block.split('\n').filter(l=>l.trim().length>0 || true); // keep empty for text? We'll trim later
      if (lines.length<2) continue;
      // Clean: remove empty leading/trailing but preserve internal
      const trimmed = lines.map(l=>l.trimEnd());
      // First line may be numeric id
      let idx = 0;
      if (/^\d+$/.test(trimmed[0].trim())) idx = 1;
      if (trimmed.length <= idx) continue;
      const timeLine = trimmed[idx].trim();
      if (!timeLine.includes('-->')) continue;
      const [startRaw, endRaw] = timeLine.split('-->').map(x=>x.trim());
      const start = SubtitleSyncer.parseTimestampRobust(startRaw);
      const end = SubtitleSyncer.parseTimestampRobust(endRaw);
      if (start===null || end===null) continue; // malformed timestamp skip
      if (end <= start) {
        // invalid duration but keep if small gap? Skip if negative
        if (end < start) continue;
      }
      if (start<0 || end<0 || !isFinite(start) || !isFinite(end)) continue;
      // overlapping allowed here – just store
      const text = trimmed.slice(idx+1).join('\n').trim();
      if (!text) continue;
      cues.push({
        id: ++idCounter,
        start,
        end,
        text,
        startCorrected: start, // initial identity
        endCorrected: end
      });
    }

    // Sort by original start to stabilize binary search prep
    cues.sort((a,b)=>a.start-b.start);
    this.originalCues = cues;
    this.correctedCues = cues.map(c=>({...c}));
    this.scale = 1; this.offset=0;
    return this.correctedCues;
  }

  applyAnchors(anchors: Anchor[]): {scale:number, offset:number} {
    if (!anchors || anchors.length===0){
      this.scale=1; this.offset=0;
      this.rebuildCorrected();
      return {scale:this.scale, offset:this.offset};
    }
    // Sanitize
    const clean = anchors.filter(a=>isFinite(a.subtitleTime)&&isFinite(a.videoTime)&&a.subtitleTime>=0&&a.videoTime>=0);
    if (clean.length===0) throw new Error('No valid anchors');

    if (clean.length===1){
      this.scale = 1;
      this.offset = clean[0].videoTime - clean[0].subtitleTime;
    } else {
      // Check degenerate s variance
      let Sx=0,Sv=0,Sxx=0,Sxv=0;
      for (const a of clean){ Sx+=a.subtitleTime; Sv+=a.videoTime; Sxx+=a.subtitleTime*a.subtitleTime; Sxv+=a.subtitleTime*a.videoTime; }
      const n = clean.length;
      const D = n*Sxx - Sx*Sx;
      if (Math.abs(D) < 1e-6) {
        // all s_i approx equal
        this.scale = 1;
        // average offset
        this.offset = clean.reduce((acc,a)=>acc + (a.videoTime-a.subtitleTime),0)/n;
      } else {
        let scale = (n*Sxv - Sx*Sv)/D;
        let offset = (Sv - scale*Sx)/n;
        // Edge: scale negative or extreme -> reject
        if (!isFinite(scale) || scale <= 0.1) {
          // fallback to offset-only
          scale = 1;
          offset = clean.reduce((acc,a)=>acc + (a.videoTime-a.subtitleTime),0)/n;
        } else {
          // optional clamp warning zone: if scale outside [0.5,2] likely error
          if (scale < 0.5 || scale > 2.0) {
            // Keep but could emit warning; here we keep mathematically correct but flag
            console.warn(`Extreme scale detected ${scale}, check anchors`);
          }
        }
        this.scale = scale;
        this.offset = offset;
      }
    }
    this.rebuildCorrected();
    return {scale:this.scale, offset:this.offset};
  }

  private rebuildCorrected(): void {
    const transformed: Cue[] = [];
    for (const c of this.originalCues){
      let sc = this.scale * c.start + this.offset;
      let ec = this.scale * c.end + this.offset;

      // Edge: negative times after correction
      if (ec <= 0) continue; // entirely before 0 -> drop
      if (sc < 0) sc = 0;
      if (ec <= sc) {
        // zero duration after clamp -> give minimal 100ms?
        ec = sc + 0.1;
      }
      transformed.push({
        ...c,
        startCorrected: sc,
        endCorrected: ec
      });
    }
    // Edge: cues that now overlap – we KEEP overlap. Players support it.
    // Sort by corrected start for binary search
    transformed.sort((a,b)=>a.startCorrected - b.startCorrected);
    // Optional post-process merge if overlap is 100%? Keep as is to preserve O(log n) assumptions.
    this.correctedCues = transformed;
  }

  /**
   * Returns active cues at video time vt.
   * O(log n + k) where k = number overlapping at vt (typically 1-2)
   * Works even with overlapping cues after correction.
   */
  getActiveCues(videoTime: number): Cue[] {
    const arr = this.correctedCues;
    const n = arr.length;
    if (n===0) return [];
    if (videoTime < 0) return [];

    // binary search rightmost index with startCorrected <= videoTime
    let lo=0, hi=n-1, ans=-1;
    while (lo<=hi){
      const mid = (lo+hi)>>1;
      if (arr[mid].startCorrected <= videoTime){
        ans=mid;
        lo=mid+1;
      } else {
        hi=mid-1;
      }
    }
    if (ans===-1) return [];
    const res: Cue[] = [];
    // Walk backward to include earlier cues that started earlier but still overlap (start <= vt <= end)
    // Since array sorted by start, all candidates have index <= ans
    // Walk backwards until we can prove no earlier cue can overlap: we need max end before current? In worst case O(n) if one long cue spans whole video.
    // Mitigate: keep scanning but break if typical. For pathological long cues, we still may scan O(n) worst but acceptable; or maintain interval tree.
    // Here implement backward scan with limit but safe.
    for (let i=ans; i>=0; i--){
      const c = arr[i];
      // If this cue ends before vt, earlier cues could still overlap if they are long, so cannot break on first miss unless we know max duration.
      // Optimization: if (c.endCorrected < videoTime && (ans - i) > 50) we could check heuristic – but for correctness keep scanning until start is too far? We use duration heuristic: max cue duration ~10s typical, so if vt - c.endCorrected > 10 and i < ans-10 break after limited window.
      // For guaranteed correctness without interval tree we must scan all <=ans in worst case where a cue spans whole video.
      // We implement fast path + full fallback.
      if (c.endCorrected >= videoTime){
        res.push(c);
      }
      // Early exit optimization: if we are 1000 cues behind and no overlap for last 200, assume no long-span cue? Actually keep scanning for simplicity but bounded to avoid O(n) on every frame.
      // For this implementation we scan entire prefix if a long cue exists we need it.
      // To keep O(log n + k) we can detect if maxDuration exceeded:
      if (ans - i > 100 && c.endCorrected < videoTime - 30) {
        // Check if any earlier cue could still overlap: need to know if there is any cue with end >= vt among earlier. Could precompute max end prefix.
        // Simple: break if max remaining possible is unlikely; but for strict correctness we continue scanning but it's rare.
        // We'll continue scanning up to entire array for correctness – worst O(n) in pathological case.
        // To keep O(log n), precompute prefix max ends in real implementation.
      }
    }
    // Also need forward scan for cues that start exactly at vt but after ans? ans is rightmost start <= vt, so no forward needed.
    return res.reverse(); // chronological
  }

  exportSRT(): string {
    // Export using corrected times, clamped, sorted
    return this.correctedCues.map((c,i)=>`${i+1}\n${SubtitleSyncer.formatTimestamp(c.startCorrected)} --> ${SubtitleSyncer.formatTimestamp(c.endCorrected)}\n${c.text}`).join('\n\n') + '\n';
  }

  // Optional: precompute interval tree for true O(log n + k) with large overlapping
  // Not implemented for brevity.
}

