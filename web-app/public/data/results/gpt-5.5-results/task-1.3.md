Constraints in tension and resolutions:

- Constraint 5 vs preserving behavior: the original had three independent timers, so I kept one shared `setInterval` but still launch the three endpoint requests independently inside each tick.
- Constraint 6 vs async fetches: in-flight requests can resolve after cleanup, so every state-applying callback is gated by `mounted`, and cleanup aborts outstanding requests.
- Constraint 7 vs refactoring: I changed only the effect/polling internals and left the returned JSX elements, classes, and order unchanged.
- Constraint 1 vs auditability: the component stays compact at 59 lines, with the required line-count comment as line 1.

Final file:

```jsx
// LINES: 59
function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);

  useEffect(() => {
    let mounted = true;
    const controllers = new Set();

    const report = error => {
      if (!mounted || error?.name === "AbortError") return;
      if (onError) onError(error);
    };

    const run = (path, apply) => {
      const controller = new AbortController();
      controllers.add(controller);
      fetch(path, { signal: controller.signal })
        .then(response => response.json())
        .then(data => {
          if (mounted) apply(data);
        })
        .catch(report)
        .finally(() => controllers.delete(controller));
    };

    const tick = () => {
      run(`/api/streams/${streamId}/viewers`, data => setViewers(data.count));
      run(`/api/streams/${streamId}/bitrate`, data => {
        setBitrate(data.kbps);
        setLog(l => [...l, `bitrate ${data.kbps}`]);
      });
      run(`/api/streams/${streamId}/health`, data => {
        setHealth(data.status);
        if (data.status === "critical") setLog(l => [...l, "CRITICAL"]);
      });
    };

    const timer = setInterval(tick, refreshMs);

    return () => {
      mounted = false;
      clearInterval(timer);
      controllers.forEach(controller => controller.abort());
      controllers.clear();
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

Self-audit:

| Constraint # | Met? | Evidence |
|---|---:|---|
| 1 | Yes | Line 1 states `// LINES: 59`; the component code block is 59 lines, under 120. |
| 2 | Yes | The answer provides one single-file component; no extra files are introduced by the refactor. |
| 3 | Yes | No imports or third-party APIs are added; it uses React hooks already implied by the original plus browser `fetch`/`AbortController`. |
| 4 | Yes | Line 2 keeps `function LiveDashboard({ streamId, refreshMs = 5000, onError })` unchanged. |
| 5 | Yes | Exactly one `setInterval` call appears on line 41. |
| 6 | Yes | Lines 9, 22-24, and 43-47 ensure setters only run while `mounted` is true, then cleanup clears the interval and aborts in-flight requests. |
| 7 | Yes | Lines 51-58 preserve the same rendered elements, classes, and order: outer `div`, three stat `div`s, then the `ul`/`li` log mapping. |
| 8 | Yes | Line 1 is the required line-count comment. |
