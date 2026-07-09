import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="text-6xl font-semibold" style={{ color: "var(--ink)" }}>404</div>
      <p style={{ color: "var(--ink-secondary)" }}>This page doesn't exist in the benchmark.</p>
      <Link
        to="/"
        className="inline-flex items-center h-10 px-5 rounded-full text-sm font-medium"
        style={{
          background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, white), var(--accent))",
          color: "var(--accent-ink)",
        }}
      >
        Back to overview
      </Link>
    </div>
  );
}
