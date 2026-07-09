```jsx
import React, { useState, useEffect, useRef } from 'react';

/**
 * NowPlaying Component
 * An elegant, dark-luxury now-playing widget designed for a Quran audio app.
 * RTL layout support, custom animated waveform, and interactive states.
 */
export default function NowPlaying() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(42); // start at 42s for preview
  const duration = 180; // 3 minutes total
  
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const phaseRef = useRef(0);

  // requestAnimationFrame (rAF) strategy:
  // To achieve jank-free 60fps animation, rendering is decoupled from React's state loop.
  // We maintain a continuous animation cycle using useRef to store the frame ID, clearing on unmount.
  // When paused, we decrease phase progression to a micro-drift (0.015) to simulate a "breathing" state.
  // When playing, phase increments faster (0.08) for a dynamic waveform driven by sine waves with edge tapering.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      
      ctx.clearRect(0, 0, w, h);
      
      const barCount = 38;
      const barWidth = 3;
      const gap = 5;
      const totalWidth = barCount * (barWidth + gap) - gap;
      const startX = (w - totalWidth) / 2;
      
      phaseRef.current += isPlaying ? 0.08 : 0.015;
      ctx.fillStyle = '#C5A880'; // Low-saturation warm gold
      
      for (let i = 0; i < barCount; i++) {
        const x = startX + i * (barWidth + gap);
        const centerOffset = Math.abs(i - barCount / 2) / (barCount / 2);
        const envelope = Math.cos(centerOffset * Math.PI / 2); // Elegant dome taper
        
        let targetHeight = 0;
        if (isPlaying) {
          targetHeight = (Math.sin(i * 0.25 + phaseRef.current) * 12 + 
                         Math.cos(i * 0.12 - phaseRef.current * 1.3) * 6 + 18) * envelope;
        } else {
          targetHeight = (Math.sin(i * 0.15 + phaseRef.current) * 3 + 6) * envelope;
        }
        
        const finalHeight = Math.max(3, targetHeight);
        const y = (h - finalHeight) / 2;
        
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, finalHeight, 1.5);
        ctx.fill();
      }
      
      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isPlaying]);

  // Handle active progress timer ticking
  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickXFromRight = rect.right - e.clientX; // RTL progress calculation
    const ratio = Math.max(0, Math.min(1, clickXFromRight / rect.width));
    setCurrentTime(Math.floor(ratio * duration));
  };

  const handleSkipBack = () => {
    setCurrentTime((prev) => Math.max(0, prev - 10));
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const percentage = (currentTime / duration) * 100;

  return (
    <div style={styles.card}>
      <style dangerouslySetInnerHTML={{ __html: hoverCSS }} />
      
      {/* Surah & Reciter Header */}
      <div style={styles.header}>
        <h1 style={styles.surahTitle} lang="ar">سُورَةُ الرَّحْمَٰنِ</h1>
        <p style={styles.reciter} lang="ar">الشيخ عبد الباسط عبد الصمد</p>
      </div>

      {/* Waveform Area */}
      <div style={styles.waveContainer}>
        <canvas ref={canvasRef} style={styles.canvas} />
      </div>

      {/* Progress Slider (RTL) */}
      <div style={styles.progressContainer}>
        <div 
          style={styles.progressBarTrack} 
          onClick={handleProgressClick}
          className="progress-track"
        >
          <div style={styles.progressBg}>
            <div style={{ ...styles.progressFill, width: `${percentage}%` }} />
            <div 
              style={{ ...styles.progressKnob, right: `calc(${percentage}% - 5px)` }} 
              className="progress-knob" 
            />
          </div>
        </div>
        <div style={styles.timeLabel}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Navigation Controls */}
      <div style={styles.controls}>
        {/* Back 10 Seconds */}
        <button 
          onClick={handleSkipBack} 
          style={styles.btnSecondary} 
          className="btn-sec"
          aria-label="رجوع ١٠ ثوانٍ"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <text x="12" y="15.5" fontSize="7.5" fontWeight="bold" fill="currentColor" textAnchor="middle" stroke="none">10</text>
          </svg>
        </button>

        {/* Play/Pause */}
        <button 
          onClick={() => setIsPlaying(!isPlaying)} 
          style={isPlaying ? styles.btnPlayActive : styles.btnPlay} 
          className="btn-main"
          aria-label={isPlaying ? "إيقاف مؤقت" : "تشغيل"}
        >
          {isPlaying ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}>
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const styles = {
  card: {
    direction: 'rtl',
    width: '360px',
    backgroundColor: '#0F0F0F', // Ultra-matte obsidian base
    border: '1px solid #1E1E1E', // Quiet dark dividing line
    borderRadius: '16px',
    padding: '28px 24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)', // Deep shadow hierarchy
    fontFamily: '"Amiri", "Scheherazade New", Georgia, serif',
    color: '#D1D1D1',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    margin: '30px auto',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    textAlign: 'center',
  },
  surahTitle: {
    fontSize: '26px',
    fontWeight: 'bold',
    color: '#C5A880', // Matte metallic gold
    margin: 0,
    textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
  },
  reciter: {
    fontSize: '13px',
    color: '#707070',
    margin: 0,
    fontFamily: '"Segoe UI", Roboto, sans-serif',
    letterSpacing: '0.3px',
  },
  waveContainer: {
    height: '64px',
    width: '100%',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  progressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  progressBarTrack: {
    width: '100%',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
  },
  progressBg: {
    width: '100%',
    height: '3px',
    backgroundColor: '#1C1C1C',
    position: 'relative',
    borderRadius: '2px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#C5A880',
    position: 'absolute',
    right: 0,
    top: 0,
    borderRadius: '2px',
  },
  progressKnob: {
    position: 'absolute',
    top: '-3.5px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#C5A880',
    boxShadow: '0 2px 4px rgba(0,0,0,0.6)',
    transition: 'transform 0.15s ease, background-color 0.15s ease',
  },
  timeLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#555',
    fontFamily: 'monospace, sans-serif',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '24px',
  },
  btnSecondary: {
    background: '#141414',
    border: '1px solid #222',
    color: '#888',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: 0,
  },
  btnPlay: {
    backgroundColor: '#C5A880',
    color: '#0A0A0A',
    border: 'none',
    borderRadius: '50%',
    width: '52px',
    height: '52px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: 0,
    boxShadow: '0 4px 12px rgba(197, 168, 128, 0.2)',
  },
  btnPlayActive: {
    backgroundColor: '#0F0F0F',
    color: '#C5A880',
    border: '1px solid #C5A880',
    borderRadius: '50%',
    width: '52px',
    height: '52px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    padding: 0,
  },
};

const hoverCSS = `
  .btn-sec:hover {
    color: #C5A880 !important;
    border-color: #333 !important;
    background: #1A1A1A !important;
  }
  .btn-sec:active {
    transform: scale(0.95);
  }
  .btn-main:hover {
    transform: scale(1.06);
  }
  .btn-main:active {
    transform: scale(0.94);
  }
  .progress-track:hover .progress-knob {
    transform: scale(1.4);
    background-color: #E5C8A0 !important;
  }
`;
```

This design is built around the concept of 'obsidian and gold leaf' luxury.
It rejects glowing overlays in favor of deep matte charcoal surfaces and high-contrast gold calligraphy.
Depth and hierarchy are achieved purely through deliberate negative space, elegant typography, and a tactile, physically responsive progress slider.
