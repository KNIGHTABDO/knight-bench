import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="glass rounded-[var(--radius-lg)] px-5 py-4 flex flex-col gap-1 min-w-[160px]">
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--ink-tertiary)" }}
      >
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
        {value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: "var(--ink-secondary)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export function StatusChip({ status }: { status: "FINAL" | "PROVISIONAL" }) {
  const isFinal = status === "FINAL";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
      style={{
        background: isFinal ? "var(--ok-bg)" : "var(--warn-bg)",
        color: isFinal ? "var(--ok)" : "var(--warn)",
        borderColor: isFinal ? "var(--ok-border)" : "var(--warn-border)",
      }}
    >
      {status}
    </span>
  );
}

export function WeightChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
      style={{
        background: "var(--accent-soft)",
        color: "var(--accent)",
        borderColor: "var(--border)",
      }}
    >
      {children}
    </span>
  );
}

export function Crown() {
  return (
    <span title="Category winner" aria-label="Category winner" className="inline-block">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z"
          fill="var(--accent)"
        />
      </svg>
    </span>
  );
}

export function Section({
  title,
  eyebrow,
  children,
  action,
}: {
  title: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          {eyebrow && (
            <div
              className="text-[11px] font-semibold uppercase tracking-wider mb-1"
              style={{ color: "var(--accent)" }}
            >
              {eyebrow}
            </div>
          )}
          <h2 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  tint = false,
}: {
  children: ReactNode;
  className?: string;
  tint?: boolean;
}) {
  return (
    <div
      className={`${tint ? "glass-tint" : "glass"} rounded-[var(--radius-lg)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}
