import { Link, useParams, Navigate } from "react-router-dom";
import { categories } from "../data/categories";
import { tasksByCategory } from "../data/tasks";
import { categoryScoreTable, deepDives, masterScoreTable } from "../data/report";
import { modelColorVar, modelOrder, modelShortName } from "../data/modelVisuals";
import { Card, Section, Crown, StatusChip } from "../components/ui";

export default function CategoryDetail() {
  const { id } = useParams();
  const categoryId = Number(id);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return <Navigate to="/categories" replace />;

  const tasks = tasksByCategory(category.id);
  const scoreRow = categoryScoreTable.find((r) => r.categoryId === category.id)!;
  const deepDive = deepDives.find((d) => d.categoryId === category.id);

  return (
    <div className="flex flex-col gap-10">
      <Link to="/categories" className="text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>
        ← All categories
      </Link>

      <div className="flex flex-col gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          Category {category.id} · weight {category.weightPercent}%
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: "var(--ink)" }}>{category.name}</h1>
        <p className="max-w-2xl text-sm" style={{ color: "var(--ink-secondary)" }}>{category.description}</p>
      </div>

      <Section eyebrow="Scores" title="Category mean by model">
        <Card>
          <div className="flex flex-col gap-3">
            {modelOrder.map((m) => (
              <div key={m} className="flex items-center gap-3">
                <span className="w-32 text-sm font-medium flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
                  {category.winner === m && <Crown />}
                  {modelShortName[m]}
                </span>
                <div className="relative flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(scoreRow[m] / 10) * 100}%`, background: modelColorVar[m] }}
                  />
                </div>
                <span className="w-10 text-right text-sm tabular-nums" style={{ color: "var(--ink-secondary)" }}>
                  {scoreRow[m].toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {deepDive && (
        <Section eyebrow="Judge's deep dive" title="What separated the models">
          <Card tint>
            <p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{deepDive.text}</p>
          </Card>
        </Section>
      )}

      <Section eyebrow={`${tasks.length} task${tasks.length > 1 ? "s" : ""}`} title="Tasks in this category">
        <div className="grid gap-4">
          {tasks.map((t) => {
            const row = masterScoreTable.find((r) => r.taskId === t.id)!;
            return (
              <Link
                key={t.id}
                to={`/tasks/${t.id}`}
                className="glass rounded-[var(--radius-lg)] p-5 flex flex-col gap-3 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-semibold rounded-full px-2 py-0.5"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    >
                      {t.id}
                    </span>
                    <span className="font-medium text-sm" style={{ color: "var(--ink)" }}>{t.title}</span>
                  </div>
                  <span className="text-xs" style={{ color: "var(--ink-tertiary)" }}>{t.estimatedTokens}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {modelOrder.map((m) => (
                    <div key={m} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: modelColorVar[m] }} />
                      {modelShortName[m]} <b style={{ color: "var(--ink)" }}>{row[m].score}</b>
                      <StatusChip status={row[m].status} />
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
