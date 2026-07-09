## Constraints in Tension

1. **#5 Single interval vs #6 No setState after unmount**: Three independent intervals each cleared separately. Consolidating to one increases lifetime of in-flight async work (3 fetches per tick). Resolution: single `mounted` ref set false in cleanup, checked after every `await` and before every `setState` / `onError` call.

2. **#5 vs #4 Props & #1 Line limit**: Original omitted `refreshMs`/`onError` from deps, causing stale closures. Fixing deps normally recreates interval. Must keep exactly one active interval while staying <120 lines. Resolution: single `useEffect` with deps `[streamId, refreshMs]`; `onError` stored in ref (`onErrorRef`) so interval doesn't churn but errors still propagate fresh.

3. **#1 Under 120 lines vs #6 Robustness vs #7 Preserve DOM**: Guarding every async path could bloat file. Resolution: minimal `useRef(true)` guard pattern (4 lines overhead) plus concise sequential try/catch, preserving JSX verbatim, total 60 lines.

4. **#5 vs behavior preservation**: Three intervals previously ran independently. Resolution: single `tick` function performs all three fetches sequentially with identical URLs and identical `setLog` patterns (`bitrate ${kbps}` and `CRITICAL`), preserving observable behavior.

## Final File

```jsx
// LINES: 60
import { useState, useEffect, useRef } from "react";

function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);
  const mounted = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    mounted.current = true;
    async function tick() {
      try {
        const r = await fetch(`/api/streams/${streamId}/viewers`);
        const j = await r.json();
        if (!mounted.current) return;
        setViewers(j.count);
      } catch (e) {
        if (mounted.current) onErrorRef.current?.(e);
      }
      try {
        const r = await fetch(`/api/streams/${streamId}/bitrate`);
        const j = await r.json();
        if (!mounted.current) return;
        setBitrate(j.kbps);
        setLog((l) => [...l, `bitrate ${j.kbps}`]);
      } catch (e) {
        if (mounted.current) onErrorRef.current?.(e);
      }
      try {
        const r = await fetch(`/api/streams/${streamId}/health`);
        const j = await r.json();
        if (!mounted.current) return;
        setHealth(j.status);
        if (j.status === "critical") {
          setLog((l) => [...l, "CRITICAL"]);
        }
      } catch (e) {
        if (mounted.current) onErrorRef.current?.(e);
      }
    }
    const id = setInterval(tick, refreshMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [streamId, refreshMs]);

  return (
    <div className="dashboard dark">
      <div className="stat viewers">{viewers}</div>
      <div className="stat bitrate">{bitrate} kbps</div>
      <div className={`stat health ${health}`}>{health}</div>
      <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}
```

## Self-Audit

| # | Constraint | Met? | Evidence |
|---|------------|------|----------|
| 1 | Under 120 lines | Yes | File has 60 lines (comment `// LINES: 60` line 1, counted via line numbers). |
| 2 | No new files | Yes | All code in single file, no imports beyond React (`useState, useEffect, useRef`). |
| 3 | No new dependencies | Yes | Only `react` used; no lodash/zustand. |
| 4 | Public API unchanged | Yes | Props remain `{ streamId, refreshMs = 5000, onError }` identical signature line 4. |
| 5 | Exactly one setInterval | Yes | Single `setInterval` call at line 45; no other timers. Original t1,t2,t3 removed. |
| 6 | No setState after unmount | Yes | `mounted` ref (line 9) set false in cleanup line 47; checked before every `setViewers` (19-20), `setBitrate`/`setLog` (27-29), `setHealth`/`setLog` (36-39), and before `onError` (22,31,42). `clearInterval` at 48 stops future ticks. |
| 7 | Preserve DOM structure | Yes | Return JSX lines 52-58 identical: `div.dashboard.dark` > `div.stat.viewers`, `div.stat.bitrate`, `div.stat.health ${health}`, `ul.log>li` map same order/classes. |
| 8 | Line-count comment | Yes | First line `// LINES: 60` matches actual file length. |
