import { categories } from "../data/categories";
import { categoryScoreTable } from "../data/report";
import { modelColorVar, modelOrder, modelShortName } from "../data/modelVisuals";

const MAX = 10;

export function CategoryBarChart() {
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-[13px]" style={{ color: "var(--ink-secondary)" }}>
        {modelOrder.map((m) => (
          <div key={m} className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: modelColorVar[m] }}
            />
            {modelShortName[m]}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {categories.map((cat) => {
          const row = categoryScoreTable.find((r) => r.categoryId === cat.id)!;
          return (
            <div key={cat.id}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  {cat.id}. {cat.name}
                </span>
                <span className="text-xs" style={{ color: "var(--ink-tertiary)" }}>
                  weight {cat.weightPercent}%
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {modelOrder.map((m) => {
                  const val = row[m];
                  const pct = (val / MAX) * 100;
                  return (
                    <div key={m} className="flex items-center gap-2 group">
                      <div
                        className="relative flex-1 h-[7px] rounded-full overflow-hidden"
                        style={{ background: "var(--bg-hover)" }}
                        title={`${modelShortName[m]}: ${val.toFixed(2)} / 10`}
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
                          style={{
                            width: `${pct}%`,
                            background: modelColorVar[m],
                          }}
                        />
                      </div>
                      <span
                        className="w-10 text-right text-xs tabular-nums shrink-0"
                        style={{ color: "var(--ink-secondary)" }}
                      >
                        {val.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
