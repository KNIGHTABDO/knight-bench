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
