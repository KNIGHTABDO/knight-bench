# Task 1.3 — LiveDashboard refactor

## Constraints in tension and how they were resolved

| Tension | Why they pull against each other | Resolution |
|--------|-----------------------------------|------------|
| **#5 (one interval) vs original three independent polls** | Three `setInterval`s fired independently; consolidating them changes timing (all three metrics refresh on the same tick). | Required by #5: one shared interval runs all three fetches each `refreshMs` tick. Per-endpoint behavior preserved (same URLs, same state fields, same log side-effects). |
| **#5 vs #6 (unmount safety)** | Async work inside the interval can resolve after cleanup; three timers made that worse. | One interval + a local `alive` flag set `false` in the effect cleanup; every `setState` / `onError` path is gated on `alive` *after* each `await`. Interval is also `clearInterval`’d on cleanup. |
| **#1 (under 120 lines) vs #6 + full fetch logic** | Guarding three fetches without new helpers/files costs lines. | Single effect, sequential guarded updates, no extra modules; keep JSX compact and identical to the original DOM. |
| **#2/#3 (one file, React only) vs structure** | Extracting hooks/utils would need new files or deps. | Everything stays in one component; only `useState` / `useEffect` from React. |
| **#4 (props API) vs correct effect deps** | Original effects listed only `[streamId]` while using `refreshMs` and `onError`. | Props signature unchanged: `{ streamId, refreshMs = 5000, onError }`. Effect deps include `streamId`, `refreshMs`, and `onError` so the single timer restarts when those change (fixes original stale-closure risk; not an API change). |
| **#7 (exact DOM) vs refactor** | Tempting to restructure markup while cleaning logic. | JSX left equivalent: same element types, `className`s, text, and order. |
| **#8 (`// LINES: n`) vs #1** | Line count must be honest and still under 120. | Count every line of the final component source (including the `// LINES` comment and blank lines); put that number in the header. |

---

## Final file

```jsx
// LINES: 59
import { useState, useEffect } from "react";

function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const r = await fetch(`/api/streams/${streamId}/viewers`);
        const j = await r.json();
        if (!alive) return;
        setViewers(j.count);
      } catch (e) {
        if (alive && onError) onError(e);
      }

      try {
        const r = await fetch(`/api/streams/${streamId}/bitrate`);
        const j = await r.json();
        if (!alive) return;
        setBitrate(j.kbps);
        setLog((l) => [...l, `bitrate ${j.kbps}`]);
      } catch (e) {
        if (alive && onError) onError(e);
      }

      try {
        const r = await fetch(`/api/streams/${streamId}/health`);
        const j = await r.json();
        if (!alive) return;
        setHealth(j.status);
        if (j.status === "critical") setLog((l) => [...l, "CRITICAL"]);
      } catch (e) {
        if (alive && onError) onError(e);
      }
    };

    const id = setInterval(tick, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [streamId, refreshMs, onError]);

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

---

## Self-audit

| Constraint # | Met? | Evidence |
|--------------|------|----------|
| **1** Final component under 120 lines | **Yes** | Component source is **59** lines (`// LINES: 59` through closing `}` of `LiveDashboard`). Under 120. |
| **2** No new files | **Yes** | Single component only; no extra modules, hooks files, or split exports. |
| **3** No new dependencies (React only) | **Yes** | Only `import { useState, useEffect } from "react"` (line 2). No lodash, zustand, or other packages. |
| **4** Public API (props) unchanged | **Yes** | Signature remains `LiveDashboard({ streamId, refreshMs = 5000, onError })` — same names, default, and optionality. |
| **5** Exactly one `setInterval` | **Yes** | Single `setInterval(tick, refreshMs)` inside one `useEffect` (line 44 of the component: `const id = setInterval(tick, refreshMs)`). No other timers. The three former polls run as sequential work inside `tick`. |
| **6** No state updates after unmount | **Yes** | `alive` starts `true`; cleanup sets `alive = false` and `clearInterval(id)`. After every `await`, `if (!alive) return` before any `setViewers` / `setBitrate` / `setHealth` / `setLog`. `onError` also gated with `alive`. After unmount, no state updater can run. |
| **7** Exact rendered DOM structure | **Yes** | Same tree: outer `div.dashboard.dark` → `div.stat.viewers` → `div.stat.bitrate` (text `{bitrate} kbps`) → `div.stat.health.${health}` → `ul.log` with `li` per log entry and `key={i}`. Classes, order, and content format unchanged. |
| **8** Line-count comment at top | **Yes** | First line: `// LINES: 59`. |

### Line-by-line count of the final component

| Line | Content |
|------|---------|
| 1 | `// LINES: 59` |
| 2 | `import { useState, useEffect } from "react";` |
| 3 | *(blank)* |
| 4 | `function LiveDashboard({ streamId, refreshMs = 5000, onError }) {` |
| 5 | `  const [viewers, setViewers] = useState(0);` |
| 6 | `  const [bitrate, setBitrate] = useState(0);` |
| 7 | `  const [health, setHealth] = useState("unknown");` |
| 8 | `  const [log, setLog] = useState([]);` |
| 9 | *(blank)* |
| 10 | `  useEffect(() => {` |
| 11 | `    let alive = true;` |
| 12 | *(blank)* |
| 13 | `    const tick = async () => {` |
| 14–21 | viewers `try/catch` with post-await `alive` guard |
| 22 | *(blank)* |
| 23–31 | bitrate `try/catch` with post-await `alive` guard + log append |
| 32 | *(blank)* |
| 33–41 | health `try/catch` with post-await `alive` guard + critical log |
| 42 | `    };` |
| 43 | *(blank)* |
| 44 | `    const id = setInterval(tick, refreshMs);` |
| 45–48 | cleanup: `alive = false`; `clearInterval(id)` |
| 49 | `  }, [streamId, refreshMs, onError]);` |
| 50 | *(blank)* |
| 51–58 | `return (` … identical DOM … `);` |
| 59 | `}` |

**Total: 59 lines.**
