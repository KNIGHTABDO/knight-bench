```jsx
import React, { useEffect, useRef, useState, useCallback } from "react";

/**
 * NowPlaying — Quran audio "now playing" module.
 * Single file, CSS-in-file (injected <style> tag), no dependencies beyond React.
 *
 * rAF STRATEGY (read before touching the animation code):
 * A single requestAnimationFrame loop is created once (on mount) and lives for the
 * component's lifetime — we never start/stop rAF on play/pause, because starting and
 * stopping rAF loops on state changes is the #1 source of jank (dropped first frames,
 * timestamp deltas that spike). Instead the loop always runs; a `playingRef` (a ref,
 * not state) gates whether the phase accumulator advances. React state (`isPlaying`,
 * `progress`) is never read inside the loop — only refs are — so re-renders triggered
 * by React never tear down or recreate the animation closure, and the animation never
 * triggers a re-render itself. The canvas is redrawn every frame directly via the 2D
 * context (imperative, outside React's render cycle); React only re-renders for
 * discrete UI state (play/pause icon, progress text). Time deltas are computed from
 * the rAF timestamp argument (not Date.now()) and clamped to avoid a huge jump after a
 * tab is backgrounded and resumed, which would otherwise cause a visible "jerk".
 */

const BAR_COUNT = 56;

// Synthesize a stable pseudo-random "waveform" so it looks like real recitation
// amplitude data (breath pauses, verse emphasis swells) rather than pure noise.
function synthesizeWaveform(seed, count) {
  const bars = [];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < count; i++) {
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(i / 6.5));
    const breath = i % 17 < 2 ? 0.15 : 1;
    bars.push(Math.max(0.08, envelope * breath * (0.55 + rand() * 0.45)));
  }
  return bars;
}

export default function NowPlaying() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0.34); // 0..1, verse position
  const [hoverSeek, setHoverSeek] = useState(false);

  const canvasRef = useRef(null);
  const playingRef = useRef(false);
  const progressRef = useRef(0.34);
  const phaseRef = useRef(0);
  const waveformRef = useRef(synthesizeWaveform(7, BAR_COUNT));
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const draw = useCallback((ts) => {
    const canvas = canvasRef.current;
    if (canvas) {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(ts - lastTsRef.current, 48); // clamp: avoid jump on tab resume
      lastTsRef.current = ts;

      if (playingRef.current) phaseRef.current += dt * 0.0028;

      const ctx = canvas.getContext("2d");
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);

      const bars = waveformRef.current;
      const gap = 3;
      const barW = w / bars.length - gap;
      const playedIdx = Math.floor((1 - progressRef.current) * bars.length); // RTL fill

      for (let i = 0; i < bars.length; i++) {
        const wobble = playingRef.current
          ? 1 + Math.sin(phaseRef.current * 3 + i * 0.7) * 0.18
          : 1;
        const amp = bars[i] * wobble;
        const barH = Math.max(3, amp * h * 0.86);
        const x = w - (i + 1) * (barW + gap); // draw right-to-left
        const y = (h - barH) / 2;
        const played = i >= playedIdx;
        ctx.fillStyle = played
          ? "rgba(199, 164, 100, 0.92)"
          : "rgba(240, 235, 224, 0.16)";
        ctx.fillRect(x, y, barW, barH);
      }
    }
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext("2d").scale(dpr, dpr);
    };
    resize();
    rafRef.current = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [draw]);

  return (
    <div className="np-root" dir="rtl">
      <style>{CSS}</style>
      <div className="np-card">
        <div className="np-reciter">مشاري بن راشد العفاسي</div>
        <div className="np-surah">
          سورة <span className="np-surah-name">الكهف</span>
        </div>

        <canvas ref={canvasRef} className="np-canvas" aria-hidden="true" />

        <div
          className={`np-progress-track ${hoverSeek ? "is-hover" : ""}`}
          onMouseEnter={() => setHoverSeek(true)}
          onMouseLeave={() => setHoverSeek(false)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (rect.right - e.clientX) / rect.width; // RTL: right = start
            setProgress(Math.min(1, Math.max(0, ratio)));
          }}
        >
          <div className="np-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="np-verse-row">
          <span>الآية ١٢ / ٣٥</span>
          <span className="np-time">٠٤:١٢ — ٠٢:٤٤</span>
        </div>

        <div className="np-controls">
          <button
            className="np-btn np-btn--back"
            onClick={() => setProgress((p) => Math.max(0, p - 0.05))}
            aria-label="ارجع ١٠ ثوانٍ"
          >
            <span className="np-btn-icon">⟲</span>
            <span className="np-btn-label">١٠</span>
          </button>

          <button
            className={`np-btn np-btn--play ${isPlaying ? "is-playing" : ""}`}
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? "إيقاف" : "تشغيل"}
          >
            {isPlaying ? "❙❙" : "▶"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.np-root { font-family: "Tahoma", "Segoe UI", sans-serif; display:flex; justify-content:center; padding: 32px; background:#0c0b09; }
.np-card {
  width: 380px; background: #16140f; padding: 28px 26px 24px;
  border: 1px solid #2a2620; position: relative;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.03);
}
.np-card::before {
  content: ""; position: absolute; inset: 10px; border: 1px solid rgba(199,164,100,0.14); pointer-events: none;
}
.np-reciter { color: #a89f8d; font-size: 13px; letter-spacing: 0.5px; margin-bottom: 4px; }
.np-surah { color: #f0ebe0; font-size: 22px; font-weight: 400; margin-bottom: 18px; }
.np-surah-name { font-family: "Traditional Arabic", "Amiri", "Scheherazade New", serif; font-size: 34px; color: #c7a464; margin-inline-start: 6px; }
.np-canvas { width: 100%; height: 64px; display: block; margin-bottom: 14px; }
.np-progress-track {
  width: 100%; height: 4px; background: rgba(240,235,224,0.1); cursor: pointer; position: relative; transition: height 0.15s ease;
}
.np-progress-track.is-hover { height: 7px; }
.np-progress-fill { height: 100%; background: #c7a464; float: right; transition: width 0.1s linear; }
.np-progress-track.is-hover .np-progress-fill { background: #d9b878; }
.np-verse-row { display: flex; justify-content: space-between; color: #776f60; font-size: 11px; margin-top: 8px; margin-bottom: 22px; }
.np-time { direction: ltr; }
.np-controls { display: flex; align-items: center; justify-content: center; gap: 22px; }
.np-btn {
  background: transparent; border: 1px solid #34302a; color: #cfc7b6; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.np-btn--back { width: 50px; height: 50px; border-radius: 50%; font-size: 11px; gap: 1px; }
.np-btn-icon { font-size: 16px; line-height: 1; }
.np-btn-label { font-size: 9px; }
.np-btn--back:hover { border-color: #c7a464; color: #c7a464; }
.np-btn--back:active { transform: scale(0.92); }
.np-btn--play {
  width: 64px; height: 64px; border-radius: 50%; font-size: 18px; border-color: #c7a464; color: #16140f;
  background: #c7a464;
}
.np-btn--play:hover { background: #d9b878; }
.np-btn--play:active { transform: scale(0.94); }
.np-btn--play.is-playing { background: #16140f; color: #c7a464; }
.np-btn--play.is-playing:hover { border-color: #d9b878; color: #d9b878; }
`;
```

DESIGN IDEA (3 lines):
The module reads as an inlaid wooden panel catching a single warm light source — depth comes from a hairline inset border, soft directional shadow, and one accent color (aged gold) used sparingly against near-black, never from blur or glow.
Hierarchy is built entirely through type scale and material contrast: calligraphic surah name vs. plain reciter label vs. muted numerals, so the eye moves reciter → surah → progress without added ornament.
The waveform and progress bar are one continuous RTL timeline — bars "play" from the right and turn gold as the fill passes them, making the generative visualization double as the scrubber's visual memory.
