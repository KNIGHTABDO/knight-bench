import { judgedModels } from "../data/models";
import { modelColorVar } from "../data/modelVisuals";

const MAX = 10;

export function WeightedTotalBars() {
  const sorted = [...judgedModels].sort((a, b) => b.weightedTotal - a.weightedTotal);
  return (
    <div className="flex flex-col gap-4">
      {sorted.map((m, i) => (
        <div key={m.id} className="flex items-center gap-3">
          <span
            className="w-6 text-sm font-semibold tabular-nums"
            style={{ color: i === 0 ? "var(--accent)" : "var(--ink-tertiary)" }}
          >
            #{i + 1}
          </span>
          <span className="w-[150px] shrink-0 text-sm font-medium truncate" style={{ color: "var(--ink)" }}>
            {m.name}
          </span>
          <div
            className="relative flex-1 h-3 rounded-full overflow-hidden"
            style={{ background: "var(--bg-hover)" }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${(m.weightedTotal / MAX) * 100}%`,
                background: modelColorVar[m.id],
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.3)",
              }}
            />
          </div>
          <span className="w-14 text-right text-sm font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
            {m.weightedTotal.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}
