```jsx
import { useEffect, useRef, useState } from "react";

export default function QuranNowPlaying() {
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.61);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const phase = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now) => {
      setProgress(p => (p + (now - last) / 180000) % 1);
      last = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d", { alpha: true });
    const dpr = window.devicePixelRatio || 1;
    const ro = () => {
      c.width = c.offsetWidth * dpr;
      c.height = c.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    ro();
    // rAF strategy: one persistent loop, no React state inside draw, phase held in ref + lerp for smoothness, dpr-scaled canvas once, cancelled on unmount/pause toggle to keep 60fps without GC or layout thrash.
    const bars = 52;
    const draw = () => {
      phase.current += playing ? 0.018 : 0.003;
      const W = c.offsetWidth, H = c.offsetHeight;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < bars; i++) {
        const t = i / bars;
        const env = Math.pow(Math.sin(t * Math.PI), 0.9);
        const a = Math.sin(i * 0.52 + phase.current * 2.1) * 0.6;
        const b = Math.cos(i * 0.31 - phase.current * 1.3) * 0.4;
        const n = Math.abs(a + b) * 0.5 + 0.08;
        const h = n * env * H * 0.92 * (playing ? 1 : 0.28);
        const x = t * W;
        const y = (H - h) / 2;
        ctx.fillStyle = i % 7 === 0 ? "#ece6d6" : i % 3 === 0 ? "#9a8f7a" : "#2a2926";
        ctx.fillRect(x, y, 1.8, h);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("resize", ro);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", ro); };
  }, [playing]);

  return (
    <div dir="rtl" className="wrap">
      <style>{`
        .wrap{--bg:#0c0b0a;--ink:#f6f1e6;--muted:#8b8578;--line:#1d1c19;--paper:#141311;
          width:390px;background:var(--bg);border-radius:24px;padding:22px 20px 16px;
          color:var(--ink);font-family:ui-serif,Amiri,serif;position:relative;
          box-shadow:inset 0 1px 0 rgba(255,248,230,.07),0 28px 60px rgba(0,0,0,.7),0 1px 0 #000;
        }
        .wrap::before{content:"";position:absolute;inset:0;border-radius:inherit;
          background:radial-gradient(120% 80% at 50% -20%,rgba(255,244,210,.06),transparent 55%);pointer-events:none}
        .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
        .kicker{font-size:10px;letter-spacing:.18em;color:var(--muted);font-family:ui-sans-serif}
        .dot{width:6px;height:6px;border-radius:50%;background:#ece6d6;box-shadow:0 0 0 6px rgba(236,230,214,.08)}
        .dot.off{background:#3a3834;box-shadow:none}
        .surah{font-size:42px;font-weight:300;line-height:.95;letter-spacing:-.02em;margin:0 0 6px; font-feature-settings:"ss01"}
        .reciter{font-size:15px;color:var(--muted);font-weight:400;margin:0 0 20px;letter-spacing:.02em}
        .canvasBox{height:64px;background:var(--paper);border-radius:14px;overflow:hidden;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 -12px 20px rgba(0,0,0,.5);margin-bottom:18px}
        canvas{width:100%;height:100%;display:block;opacity:${playing ? 1 : 0.55};transition:opacity .4s}
        .progress{height:2px;background:var(--line);border-radius:1px;position:relative;overflow:hidden;margin-bottom:10px}
        .fill{position:absolute;right:0;top:0;bottom:0;background:#ece6d6;width:var(--w);transition:width .2s linear}
        .meta{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-family:ui-monospace;margin-bottom:18px}
        .controls{display:flex;gap:10px;align-items:center}
        .btn{flex:1;height:52px;border-radius:16px;border:1px solid #22201d;background:#181613;color:var(--ink);
          cursor:pointer;display:grid;place-items:center;font-family:ui-sans-serif;transition:all .18s}
        .btn:hover{background:#1e1c19;transform:translateY(-1px);box-shadow:0 8px 20px rgba(0,0,0,.4)}
        .btn:active{transform:translateY(0) scale(.98);box-shadow:inset 0 2px 10px rgba(0,0,0,.6)}
        .btnPrimary{flex:1.2;background:#ece6d6;color:#0e0d0b;border-color:#ece6d6}
        .btnPrimary:hover{background:#fff7e6}
        .btn svg{width:18px;height:18px}
      `}</style>

      <div className="top">
        <span className="kicker">ٱلْآنَ يُشَغَّلُ • ٤:٤٤</span>
        <div className={`dot ${playing ? "" : "off"}`} />
      </div>

      <h1 className="surah">سُورَةُ البَقَرَة</h1>
      <p className="reciter">الشيخ مشاري راشد العفاسي — رواية حفص</p>

      <div className="canvasBox"><canvas ref={canvasRef} /></div>

      <div className="progress"><div className="fill" style={{ ["--w"]: `${Math.round(progress * 100)}%` }} /></div>
      <div className="meta"><span>الآية ٢٨٤ من ٢٨٦</span><span>{String(Math.floor(progress*280)).padStart(2,"0")}:١٢ / ٠٤:٤٤</span></div>

      <div className="controls">
        <button className="btn" onClick={() => setProgress(p => Math.max(0, p - 0.04))} aria-label="10 ثواني للخلف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M9 8L5 12L9 16"/><path d="M5 12H13C16.3 12 19 14.7 19 18"/><text x="12" y="11" fontSize="7" fill="currentColor" stroke="none" textAnchor="middle">١٠</text></svg>
        </button>
        <button className="btn btnPrimary" onClick={() => setPlaying(v => !v)} aria-label={playing ? "إيقاف" : "تشغيل"}>
          {playing ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg>
                   : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 6.5L18 12L8 17.5V6.5Z"/></svg>}
        </button>
      </div>
    </div>
  );
}
```

Design idea: A single cold stone slab lit from above like a mosque floor at night.
Depth comes from carved inset shadows and letter-pressed paper, not effects.
Typography is the ornament.
