import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { models } from "../data/models";
import { categories } from "../data/categories";
import { categoryScoreTable, masterScoreTable } from "../data/report";
import { taskById } from "../data/tasks";
import { modelColorVar } from "../data/modelVisuals";
import type { ModelId } from "../data/types";
import { Card, Section, StatusChip, Crown } from "../components/ui";
import { RemoteMarkdown } from "../components/RemoteMarkdown";

export default function ModelDetail() {
  const { id } = useParams<{ id: string }>();
  const model = models.find((m) => m.id === id);
  const [tab, setTab] = useState<"summary" | "run-log">("summary");
  if (!model) return <Navigate to="/models" replace />;
  const modelId = model.id as ModelId;

  return (
    <div className="flex flex-col gap-10">
      <Link to="/models" className="text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>← All models</Link>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: modelColorVar[modelId] }} />
          <div className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            results/{model.resultsDir}/
          </div>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: "var(--ink)" }}>{model.name}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><div className="text-xs mb-1" style={{ color: "var(--ink-tertiary)" }}>Weighted total</div><div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{model.weightedTotal.toFixed(3)}</div></Card>
        <Card><div className="text-xs mb-1" style={{ color: "var(--ink-tertiary)" }}>FINAL-only</div><div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{model.finalOnlyNormalized.toFixed(3)}</div></Card>
        <Card><div className="text-xs mb-1" style={{ color: "var(--ink-tertiary)" }}>Settled contribution</div><div className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{model.settledContribution.toFixed(3)}</div></Card>
        <Card><div className="text-xs mb-1" style={{ color: "var(--ink-tertiary)" }}>Provisional swing</div><div className="text-sm tabular-nums mt-1.5" style={{ color: "var(--ink-secondary)" }}>{model.provisionalIfZero.toFixed(2)} – {model.provisionalIfTen.toFixed(2)}</div></Card>
      </div>

      <Section eyebrow="By category" title="Category means">
        <Card>
          <div className="flex flex-col gap-3">
            {categories.map((c) => {
              const row = categoryScoreTable.find((r) => r.categoryId === c.id)!;
              const val = row[modelId];
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <Link to={`/categories/${c.id}`} className="w-64 shrink-0 text-sm truncate flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
                    {c.winner === modelId && <Crown />}
                    {c.id}. {c.name}
                  </Link>
                  <div className="relative flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(val / 10) * 100}%`, background: modelColorVar[modelId] }} />
                  </div>
                  <span className="w-10 text-right text-sm tabular-nums" style={{ color: "var(--ink-secondary)" }}>{val.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      <Section eyebrow="Every task" title="Task-by-task results">
        <Card className="!p-0 overflow-hidden">
          <div className="kb-table-wrap">
            <table className="w-full text-sm" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Task</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Score</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Status</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Auto-checks</th>
                </tr>
              </thead>
              <tbody>
                {masterScoreTable.map((row) => {
                  const s = row[modelId];
                  const task = taskById(row.taskId);
                  return (
                    <tr key={row.taskId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3">
                        <Link to={`/tasks/${row.taskId}`} className="font-medium" style={{ color: "var(--accent)" }}>{row.taskId}</Link>
                        <div className="text-xs" style={{ color: "var(--ink-tertiary)" }}>{task.title}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{s.score}</td>
                      <td className="px-4 py-3"><StatusChip status={s.status} /></td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ink-secondary)" }}>{s.autoChecksPassed}/{s.autoChecksTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section
        eyebrow="Run artifacts"
        title="Summary & run log"
        action={
          <div className="flex gap-1.5">
            <button
              onClick={() => setTab("summary")}
              className="text-xs font-medium rounded-full px-3 py-1.5"
              style={{ background: tab === "summary" ? "var(--accent-soft)" : "transparent", color: tab === "summary" ? "var(--accent)" : "var(--ink-tertiary)", border: `1px solid ${tab === "summary" ? "var(--accent)" : "var(--border)"}` }}
            >
              summary.md
            </button>
            <button
              onClick={() => setTab("run-log")}
              className="text-xs font-medium rounded-full px-3 py-1.5"
              style={{ background: tab === "run-log" ? "var(--accent-soft)" : "transparent", color: tab === "run-log" ? "var(--accent)" : "var(--ink-tertiary)", border: `1px solid ${tab === "run-log" ? "var(--accent)" : "var(--border)"}` }}
            >
              run-log.md
            </button>
          </div>
        }
      >
        <Card>
          <RemoteMarkdown key={tab} src={`/data/results/${model.resultsDir}/${tab === "summary" ? "summary" : "run-log"}.md`} />
        </Card>
      </Section>
    </div>
  );
}
