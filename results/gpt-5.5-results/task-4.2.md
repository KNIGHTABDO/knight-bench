import React, { useEffect, useMemo, useRef, useState } from "react";

export default function QuranNowPlaying() {
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.42);
  const canvasRef = useRef(null);
  const playingRef = useRef(playing);
  const progressRef = useRef(progress);

  const bars = useMemo(() => {
    return Array.from({ length: 96 }, (_, index) => {
      const phrase = Math.sin(index * 0.31) * 0.34 + Math.sin(index * 0.097 + 1.9) * 0.22;
      const consonant = ((index * 37) % 19) / 19;
      return 0.18 + Math.abs(phrase) + consonant * 0.36;
    });
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let rafId = 0;
    let lastTime = performance.now();
    let phase = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time) => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const delta = Math.min(34, time - lastTime);
      lastTime = time;

      /* rAF strategy: one persistent loop only paints canvas math, while React state
         updates are throttled to coarse audio-style progress changes to keep 60fps smooth. */
      if (playingRef.current) {
        phase += delta * 0.0038;
        if (time % 180 < delta) {
          setProgress((value) => (value >= 0.985 ? 0 : Math.min(0.985, value + 0.0016)));
        }
      }

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0a0907";
      context.fillRect(0, 0, width, height);

      const center = height / 2;
      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (bars.length - 1)) / bars.length);
      const activeFromRight = width * progressRef.current;

      context.fillStyle = "rgba(245, 237, 218, 0.055)";
      for (let y = 8; y < height; y += 9) context.fillRect(0, y, width, 1);

      bars.forEach((base, index) => {
        const x = width - (index + 1) * (barWidth + gap) + gap;
        const breath = playingRef.current ? Math.sin(phase + index * 0.42) * 0.18 : 0;
        const heightScale = Math.max(0.12, Math.min(1, base + breath));
        const barHeight = 12 + heightScale * (height - 28);
        const isPassed = width - x <= activeFromRight;
        const top = center - barHeight / 2;

        context.fillStyle = isPassed ? "#d8bd79" : "#3a3329";
        context.globalAlpha = isPassed ? 0.92 : 0.68;
        context.fillRect(x, top, barWidth, barHeight);

        context.fillStyle = isPassed ? "#fff6d6" : "#6d604d";
        context.globalAlpha = isPassed ? 0.42 : 0.18;
        context.fillRect(x, top, barWidth, 2);
      });

      context.globalAlpha = 1;
      rafId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [bars]);

  const backTen = () => setProgress((value) => Math.max(0, value - 10 / 372));
  const percent = Math.round(progress * 100);

  return (
    <section className="quranNow" dir="rtl" aria-label="مشغل القرآن الحالي">
      <style>{`
        .quranNow {
          width: min(430px, 100%);
          color: #f5ead0;
          background: #0a0907;
          border: 1px solid #242018;
          box-shadow: 0 24px 64px rgba(0, 0, 0, .46), inset 0 1px 0 rgba(255, 244, 212, .055), inset 0 -18px 45px rgba(0, 0, 0, .38);
          padding: 26px;
          font-family: Georgia, "Times New Roman", serif;
          isolation: isolate;
          position: relative;
          overflow: hidden;
        }
        .quranNow::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: .18;
          background-image: radial-gradient(circle at 22% 18%, rgba(255,255,255,.08) 0 1px, transparent 1px), linear-gradient(115deg, transparent 0 42%, rgba(232,205,139,.06) 45%, transparent 49%);
          background-size: 17px 17px, 100% 100%;
          mix-blend-mode: screen;
        }
        .npTop, .npMeta, .npControls, .npProgressRow { position: relative; z-index: 1; }
        .npTop {
          display: grid;
          gap: 10px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(216, 189, 121, .18);
        }
        .npKicker {
          margin: 0;
          color: #95876c;
          font: 600 12px/1.2 Arial, sans-serif;
          letter-spacing: 0;
        }
        .npSurah {
          margin: 0;
          color: #f6e6bd;
          font-size: clamp(38px, 10vw, 58px);
          line-height: .95;
          font-weight: 700;
          text-shadow: 0 1px 0 #4b3c23, 0 10px 22px rgba(0,0,0,.62);
        }
        .npReciter {
          margin: 0;
          color: #c7b88f;
          font-size: 18px;
          line-height: 1.4;
        }
        .npMeta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 18px 0 12px;
          color: #a6997c;
          font: 700 12px/1 Arial, sans-serif;
        }
        .npVerse { color: #ead7a8; }
        .npCanvasWrap {
          position: relative;
          z-index: 1;
          height: 118px;
          border: 1px solid #211d17;
          background: #0a0907;
          box-shadow: inset 0 13px 28px rgba(255,255,255,.025), inset 0 -20px 32px rgba(0,0,0,.5);
        }
        .npCanvas { display: block; width: 100%; height: 100%; }
        .npProgressRow { margin: 14px 0 22px; }
        .npTrack {
          height: 8px;
          background: #221e18;
          box-shadow: inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.04);
          overflow: hidden;
        }
        .npFill {
          height: 100%;
          margin-right: auto;
          background: #d0af63;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.24), 0 0 0 1px rgba(0,0,0,.2);
          transition: width .18s linear;
        }
        .npControls {
          display: grid;
          grid-template-columns: 1fr 76px 1fr;
          align-items: center;
          gap: 14px;
        }
        .npButton {
          appearance: none;
          border: 1px solid #3a3022;
          color: #f3e6c5;
          background: #15120e;
          cursor: pointer;
          font: 800 15px/1 Arial, sans-serif;
          min-height: 50px;
          box-shadow: 0 10px 24px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.06);
          transition: transform .16s ease, border-color .16s ease, background .16s ease, color .16s ease;
        }
        .npButton:hover { background: #1c1711; border-color: #7b6235; color: #fff4d2; }
        .npButton:active { transform: translateY(2px); box-shadow: inset 0 3px 8px rgba(0,0,0,.55); }
        .npButton:focus-visible { outline: 2px solid #d8bd79; outline-offset: 3px; }
        .npPlay {
          width: 76px;
          height: 76px;
          border-radius: 50%;
          font-size: 24px;
          color: #0a0907;
          background: #d8bd79;
          border-color: #f1dc9d;
          box-shadow: 0 16px 34px rgba(0,0,0,.44), inset 0 2px 0 rgba(255,255,255,.35), inset 0 -6px 0 rgba(88,64,24,.22);
        }
        .npPlay:hover { background: #e5ca82; color: #050403; }
        .npBack { justify-self: end; padding: 0 18px; }
        .npState {
          justify-self: start;
          color: ${playing ? "#d8bd79" : "#84765d"};
          font: 800 12px/1 Arial, sans-serif;
          text-transform: uppercase;
        }
      `}</style>

      <div className="npTop">
        <p className="npKicker">يستمع الآن</p>
        <h2 className="npSurah">سورة الرحمن</h2>
        <p className="npReciter">عبد الباسط عبد الصمد</p>
      </div>

      <div className="npMeta">
        <span className="npVerse">الآية ٣٨ من ٧٨</span>
        <span>{percent}%</span>
      </div>

      <div className="npCanvasWrap" aria-hidden="true">
        <canvas className="npCanvas" ref={canvasRef} />
      </div>

      <div className="npProgressRow" aria-label={`تقدم التلاوة ${percent} بالمئة`}>
        <div className="npTrack">
          <div className="npFill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="npControls">
        <span className="npState">{playing ? "playing" : "paused"}</span>
        <button className="npButton npPlay" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}>
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button className="npButton npBack" onClick={backTen} aria-label="رجوع عشر ثوان">
          ↺ ١٠
        </button>
      </div>
    </section>
  );
}

Design idea: A quiet black-stone mihrab for listening.
The depth comes from carved shadow, worn brass, and paper-fine surface texture.
The motion behaves like measured breath moving right-to-left through recitation.
