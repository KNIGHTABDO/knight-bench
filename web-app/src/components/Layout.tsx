import { NavLink, Outlet } from "react-router-dom";

const nav = [
  { to: "/", label: "Overview", end: true },
  { to: "/report", label: "Judge Report" },
  { to: "/categories", label: "Categories" },
  { to: "/models", label: "Models" },
  { to: "/spec", label: "Full Spec" },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="glass sticky top-3 z-50 mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-[1180px] items-center justify-between gap-3 rounded-full px-3 py-2 sm:px-5"
      >
        <NavLink to="/" className="flex items-center gap-2 shrink-0 pl-1">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 20h12M7 20l.6-3.5c.2-1.1.9-2 1.9-2.5l1-.5-2-2.5c-.6-.7-.5-1.8.2-2.4l2.6-2.2-1-1.6a1 1 0 011.4-1.4l1.4 1 2-1.6 1 1.6-2.3 2 1.8 1.6c.7.6.8 1.7.2 2.4l-2 2.4 1 .6c1 .5 1.7 1.4 1.9 2.5L17 20"
              stroke="var(--accent)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-semibold text-[15px] tracking-tight hidden sm:inline" style={{ color: "var(--ink)" }}>
            KNIGHT-BENCH
          </span>
        </NavLink>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive ? "" : ""
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? "var(--accent-ink)" : "var(--ink-secondary)",
                background: isActive
                  ? "linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, white), var(--accent))"
                  : "transparent",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition-transform active:scale-95"
          style={{ background: "var(--bg-hover)" }}
          aria-label="View source on GitHub"
          title="View source on GitHub"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--ink-secondary)">
            <path d="M12 .5C5.73.5.98 5.24.98 11.52c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55v-2.15c-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.26-1.67-1.26-1.67-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.14 1.16a10.9 10.9 0 015.72 0c2.18-1.47 3.14-1.16 3.14-1.16.62 1.58.23 2.75.11 3.04.73.79 1.17 1.8 1.17 3.04 0 4.35-2.66 5.31-5.19 5.59.41.35.77 1.04.77 2.11v3.13c0 .3.21.66.79.55 4.51-1.51 7.77-5.76 7.77-10.78C23.02 5.24 18.27.5 12 .5z" />
          </svg>
        </a>
      </header>
      <main className="flex-1 mx-auto w-full max-w-[1180px] px-4 sm:px-6 pb-24 pt-8">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[1180px] px-6 pb-10 text-[12px]" style={{ color: "var(--ink-tertiary)" }}>
        KNIGHT-BENCH v1 · personal, reproducible frontier-model benchmark · Owner: Knight (@jip7e) · Created 2026-07-09 · Open source.
      </footer>
    </div>
  );
}
