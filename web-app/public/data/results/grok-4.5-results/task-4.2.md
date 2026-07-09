```jsx
import React, { useRef, useEffect, useState, useCallback } from "react";

/**
 * NowPlaying — dark-luxury Quran audio module (RTL).
 * Depth via warm rim light, fine grain, type weight & space — not glass/neon/gradient borders.
 *
 * rAF strategy: one loop owns canvas paint + phase. Stamp lastTs, compute dt; only draw when
 * dt >= 16.5ms (≈60fps). Phase advances only while playing; cancel rAF on unmount. Waveform =
 * layered sines + envelope (fake data) — no DOM thrash, no per-bar React state.
 */
export default function NowPlaying() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const phaseRef = useRef(0);
  const lastTsRef = useRef(0);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0.34);
  const [verse, setVerse] = useState(12);
  const total = 54;
  playingRef.current = playing;

  const draw = useCallback((ts) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const dt = ts - lastTsRef.current;
    if (dt < 16.5 && lastTsRef.current !== 0) {
      rafRef.current = requestAnimationFrame(draw); return;
    }
    lastTsRef.current = ts;
    if (playingRef.current) phaseRef.current += dt * 0.0022;
    const p = phaseRef.current, bars = 48, gap = 2, barW = (w - gap * (bars - 1)) / bars, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(201,168,106,0.08)";
    ctx.fillRect(0, mid - 0.5, w, 1);
    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      const env = 0.35 + 0.45 * Math.sin(t * Math.PI) + 0.2 * Math.sin(t * Math.PI * 3 + p * 0.7);
      const wave = Math.sin(p * 1.6 + i * 0.38) * 0.55 + Math.sin(p * 2.9 + i * 0.91) * 0.28 + Math.sin(p * 0.4 + i * 0.12) * 0.17;
      const amp = env * (0.25 + 0.75 * Math.abs(wave));
      const bh = Math.max(3, amp * h * 0.78), x = i * (barW + gap), y = mid - bh / 2;
      const a = playingRef.current ? 0.55 + amp * 0.4 : 0.22 + amp * 0.18;
      ctx.fillStyle = `rgba(212,175,110,${a})`;
      const r = Math.min(1.5, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + bh - r); ctx.quadraticCurveTo(x + barW, y + bh, x + barW - r, y + bh);
      ctx.lineTo(x + r, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.fill();
    }
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, playing]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setProgress((pr) => {
        const n = Math.min(1, pr + 0.004);
        if (n >= 1) { setVerse((v) => Math.min(total, v + 1)); return 0; }
        return n;
      });
    }, 200);
    return () => clearInterval(id);
  }, [playing]);

  const btn = (base, hover, active) => ({
    onMouseEnter: (e) => Object.assign(e.currentTarget.style, hover),
    onMouseLeave: (e) => Object.assign(e.currentTarget.style, base),
    onMouseDown: (e) => Object.assign(e.currentTarget.style, active),
    onMouseUp: (e) => Object.assign(e.currentTarget.style, hover),
  });

  return (
    <div style={S.root} dir="rtl">
      <div style={S.grain} aria-hidden />
      <div style={S.rim} aria-hidden />
      <header style={S.header}>
        <p style={S.reciter}>مشاري راشد العفاسي</p>
        <h1 style={S.surah}>سورة الرحمن</h1>
        <p style={S.verseMeta}>الآية {verse}<span style={S.sep}>·</span>{total}</p>
      </header>
      <div style={S.viz}><canvas ref={canvasRef} style={S.canvas} aria-hidden /></div>
      <div style={S.progBlock}>
        <div style={S.track} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ ...S.fill, transform: `scaleX(${progress})` }} />
        </div>
        <div style={S.timeRow}><span>٠٢:١٤</span><span style={{ opacity: 0.7 }}>٠٦:٤٠</span></div>
      </div>
      <div style={S.controls}>
        <button type="button" style={S.sec} aria-label="رجوع ١٠ ثوانٍ" onClick={() => setProgress((p) => Math.max(0, p - 0.08))} {...btn(S.sec, S.secH, S.secA)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M11 7l-6 5 6 5V7z" fill="currentColor" />
            <path d="M18 7l-6 5 6 5V7z" fill="currentColor" opacity=".55" />
            <text x="12" y="22" textAnchor="middle" fontSize="7" fill="currentColor" fontFamily="system-ui">١٠</text>
          </svg>
        </button>
        <button
          type="button"
          style={playing ? S.priOn : S.pri}
          aria-label={playing ? "إيقاف" : "تشغيل"}
          onClick={() => setPlaying((v) => !v)}
          {...btn(playing ? S.priOn : S.pri, playing ? S.priOnH : S.priH, S.priA)}
        >
          {playing ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5-11-6.5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const B = "#c9a86a", BD = "#8a7040", P = "#e8dfd0", M = "#8a8278", I = "#0c0b0a";
const g = (w, h, r, extra = {}) => ({ width: w, height: h, borderRadius: r, display: "grid", placeItems: "center", cursor: "pointer", ...extra });
const S = {
  root: {
    position: "relative", direction: "rtl", width: "100%", maxWidth: 380, margin: "0 auto",
    padding: "32px 28px 28px", background: "#141210", color: P,
    fontFamily: "'Segoe UI','Noto Naskh Arabic','Traditional Arabic',serif", borderRadius: 4, overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(201,168,106,.12), inset 0 1px 0 rgba(232,223,208,.06)",
  },
  grain: {
    pointerEvents: "none", position: "absolute", inset: 0, opacity: 0.045, mixBlendMode: "overlay",
    backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
  },
  rim: { pointerEvents: "none", position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "rgba(232,223,208,.1)" },
  header: { textAlign: "center", marginBottom: 28, position: "relative" },
  reciter: { margin: "0 0 10px", fontSize: 13, letterSpacing: ".04em", color: M, fontWeight: 400 },
  surah: {
    margin: "0 0 12px", fontSize: 34, fontWeight: 600, lineHeight: 1.35, color: P, letterSpacing: ".02em",
    textShadow: "0 1px 0 rgba(0,0,0,.45)", borderBottom: `2px solid ${BD}`, display: "inline-block", paddingBottom: 6,
  },
  verseMeta: { margin: "14px 0 0", fontSize: 12, color: B, letterSpacing: ".06em", fontVariantNumeric: "tabular-nums" },
  sep: { margin: "0 8px", color: M },
  viz: { height: 72, marginBottom: 22, borderTop: "1px solid rgba(201,168,106,.1)", borderBottom: "1px solid rgba(201,168,106,.1)", padding: "8px 0", background: I },
  canvas: { display: "block", width: "100%", height: "100%" },
  progBlock: { marginBottom: 26 },
  track: { height: 3, background: "rgba(232,223,208,.08)", borderRadius: 1, overflow: "hidden", position: "relative" },
  fill: { position: "absolute", inset: 0, background: B, transformOrigin: "right center", transition: "transform 160ms ease-out" },
  timeRow: { display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: M, fontVariantNumeric: "tabular-nums" },
  controls: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20 },
  sec: g(48, 48, 2, { border: "1px solid rgba(201,168,106,.28)", background: "transparent", color: B, transition: "background 140ms,border-color 140ms,color 140ms,transform 100ms" }),
  secH: g(48, 48, 2, { border: "1px solid rgba(201,168,106,.55)", background: "rgba(201,168,106,.06)", color: P }),
  secA: g(48, 48, 2, { border: "1px solid rgba(201,168,106,.7)", background: "rgba(201,168,106,.12)", color: P, transform: "scale(.96)" }),
  pri: g(64, 64, 2, { border: `1px solid ${BD}`, background: B, color: I, boxShadow: "inset 0 1px 0 rgba(255,255,255,.18), 0 8px 20px rgba(0,0,0,.35)", transition: "background 140ms,box-shadow 140ms,transform 100ms" }),
  priH: g(64, 64, 2, { border: `1px solid ${B}`, background: "#d8bc84", color: I, boxShadow: "inset 0 1px 0 rgba(255,255,255,.22), 0 10px 24px rgba(0,0,0,.4)" }),
  priOn: g(64, 64, 2, { border: "1px solid rgba(201,168,106,.45)", background: I, color: B, boxShadow: "inset 0 0 0 1px rgba(201,168,106,.2), 0 6px 16px rgba(0,0,0,.4)" }),
  priOnH: g(64, 64, 2, { border: "1px solid rgba(201,168,106,.7)", background: "#1a1814", color: P, boxShadow: "inset 0 0 0 1px rgba(201,168,106,.3), 0 8px 18px rgba(0,0,0,.45)" }),
  priA: g(64, 64, 2, { border: `1px solid ${BD}`, background: BD, color: I, transform: "scale(.97)", boxShadow: "inset 0 2px 4px rgba(0,0,0,.25)" }),
};
```

Design idea: a carved brass-and-parchment listening panel —
depth from rim light, paper grain, and typographic mass,
not glass, neon, or gradient borders.
```
