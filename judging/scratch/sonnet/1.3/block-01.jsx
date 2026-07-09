// LINES: 52
import { useEffect, useRef, useState } from "react";

const ENDPOINTS = ["viewers", "bitrate", "health"];

function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const tick = async () => {
      let newBitrate, newHealth;
      for (const kind of ENDPOINTS) {
        try {
          const r = await fetch(`/api/streams/${streamId}/${kind}`);
          const j = await r.json();
          if (!isMounted.current) return;
          if (kind === "viewers") setViewers(j.count);
          if (kind === "bitrate") newBitrate = j.kbps;
          if (kind === "health") newHealth = j.status;
        } catch (e) {
          if (isMounted.current) onError && onError(e);
        }
      }
      if (!isMounted.current) return;
      if (newBitrate !== undefined) {
        setBitrate(newBitrate);
        setLog((l) => [...l, `bitrate ${newBitrate}`]);
      }
      if (newHealth !== undefined) {
        setHealth(newHealth);
        if (newHealth === "critical") setLog((l) => [...l, "CRITICAL"]);
      }
    };
    const t = setInterval(tick, refreshMs);
    return () => {
      isMounted.current = false;
      clearInterval(t);
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

export default LiveDashboard;
