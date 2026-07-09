// LINES: 53
import React, { useState, useEffect } from "react";

export default function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);

  useEffect(() => {
    let active = true;
    const runFetch = async (url, successCallback) => {
      try {
        const r = await fetch(url);
        const j = await r.json();
        if (active) successCallback(j);
      } catch (e) {
        if (active && onError) onError(e);
      }
    };

    const tick = () => {
      runFetch(`/api/streams/${streamId}/viewers`, (j) => setViewers(j.count));
      runFetch(`/api/streams/${streamId}/bitrate`, (j) => {
        setBitrate(j.kbps);
        setLog((l) => [...l, `bitrate ${j.kbps}`]);
      });
      runFetch(`/api/streams/${streamId}/health`, (j) => {
        setHealth(j.status);
        if (j.status === "critical") setLog((l) => [...l, "CRITICAL"]);
      });
    };

    const timer = setInterval(tick, refreshMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [streamId, refreshMs, onError]);

  return (
    <div className="dashboard dark">
      <div className="stat viewers">{viewers}</div>
      <div className="stat bitrate">{bitrate} kbps</div>
      <div className={`stat health ${health}`}>{health}</div>
      <ul className="log">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
