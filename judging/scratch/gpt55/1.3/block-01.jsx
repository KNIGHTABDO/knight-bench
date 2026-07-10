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
