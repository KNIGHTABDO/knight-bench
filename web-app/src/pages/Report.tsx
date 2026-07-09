import { Link } from "react-router-dom";
import { categoryById } from "../data/categories";
import { taskById } from "../data/tasks";
import {
  masterScoreTable,
  categoryScoreTable,
  deepDives,
  trapPerformance,
  failureTaxonomy,
  costEfficiencyNote,
  anomalies,
  ownerActionList,
  provisionalSwing,
  conflictStatement,
  scopeNote,
  executiveVerdict,
} from "../data/report";
import { modelColorVar, modelOrder, modelShortName } from "../data/modelVisuals";
import { modelById } from "../data/models";
import { Card, Section, StatusChip, Crown } from "../components/ui";

export default function Report() {
  return (
    <div className="flex flex-col gap-14">
      <div className="flex flex-col gap-3 fade-up">
        <div className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          judging/KNIGHT-BENCH-v1-REPORT.md
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: "var(--ink)" }}>
          KNIGHT-BENCH v1 Judge Report
        </h1>
        <p className="max-w-3xl text-sm" style={{ color: "var(--ink-secondary)" }}>{executiveVerdict.summary}</p>
        <p className="max-w-3xl text-sm" style={{ color: "var(--ink-secondary)" }}>{executiveVerdict.personalityRead}</p>
      </div>

      <div className="glass-tint rounded-[var(--radius-lg)] p-5 flex flex-col gap-2 text-sm" style={{ color: "var(--ink-secondary)" }}>
        <div><span className="font-semibold" style={{ color: "var(--warn)" }}>Conflict statement — </span>{conflictStatement}</div>
        <div><span className="font-semibold" style={{ color: "var(--warn)" }}>Scope note — </span>{scopeNote}</div>
      </div>

      <Section eyebrow="§2" title="Master score table">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          One row per task. Score is the 0–10 rubric band; auto-checks are the mechanical
          pass/fail count from the task's own checklist. Click a task ID for its full prompt,
          rubric, and every raw model output.
        </p>
        <Card className="!p-0 overflow-hidden">
          <div className="kb-table-wrap">
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Task</th>
                  {modelOrder.map((m) => (
                    <th key={m} className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>
                      {modelShortName[m]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {masterScoreTable.map((row) => {
                  const task = taskById(row.taskId);
                  return (
                    <tr key={row.taskId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3 align-top">
                        <Link to={`/tasks/${row.taskId}`} className="font-medium" style={{ color: "var(--accent)" }}>
                          {row.taskId}
                        </Link>
                        <div className="text-xs mt-0.5" style={{ color: "var(--ink-tertiary)" }}>{task.title}</div>
                      </td>
                      {modelOrder.map((m) => {
                        const s = row[m];
                        return (
                          <td key={m} className="px-4 py-3 align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{s.score}</span>
                              <span className="text-xs tabular-nums" style={{ color: "var(--ink-tertiary)" }}>
                                {s.autoChecksPassed}/{s.autoChecksTotal}
                              </span>
                            </div>
                            <div className="mt-1"><StatusChip status={s.status} /></div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section eyebrow="§3" title="Category scores">
        <Card className="!p-0 overflow-hidden">
          <div className="kb-table-wrap">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Category</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Weight</th>
                  {modelOrder.map((m) => (
                    <th key={m} className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>{modelShortName[m]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoryScoreTable.map((row) => {
                  const cat = categoryById(row.categoryId);
                  return (
                    <tr key={row.categoryId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3">
                        <Link to={`/categories/${cat.id}`} className="font-medium" style={{ color: "var(--ink)" }}>
                          {cat.id}. {cat.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ink-secondary)" }}>{cat.weightPercent}%</td>
                      {modelOrder.map((m) => (
                        <td key={m} className="px-4 py-3 tabular-nums" style={{ color: cat.winner === m ? modelColorVar[m] : "var(--ink)" }}>
                          <span className="inline-flex items-center gap-1 font-medium">
                            {cat.winner === m && <Crown />}
                            {row[m].toFixed(2)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
                  <td className="px-4 py-3 font-semibold" colSpan={2} style={{ color: "var(--ink)" }}>Weighted total (all scores)</td>
                  {modelOrder.map((m) => (
                    <td key={m} className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{modelById(m).weightedTotal.toFixed(3)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 text-xs" colSpan={2} style={{ color: "var(--ink-tertiary)" }}>FINAL-only normalized</td>
                  {modelOrder.map((m) => (
                    <td key={m} className="px-4 py-3 text-xs tabular-nums" style={{ color: "var(--ink-tertiary)" }}>{modelById(m).finalOnlyNormalized.toFixed(3)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section eyebrow="§4" title="Head-to-head deep dives">
        <div className="grid gap-4">
          {deepDives.map((d) => (
            <Card key={d.categoryId} tint>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--accent)" }}>
                {d.title}
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{d.text}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section eyebrow="§5" title="Trap performance">
        <div className="grid gap-3">
          {trapPerformance.map((t) => (
            <Card key={t.taskId} className="!py-4">
              <div className="flex gap-3">
                <Link to={`/tasks/${t.taskId}`} className="text-sm font-semibold shrink-0" style={{ color: "var(--accent)" }}>
                  {t.taskId}
                </Link>
                <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>{t.text}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section eyebrow="§6" title="Failure taxonomy">
        <Card><p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{failureTaxonomy}</p></Card>
      </Section>

      <Section eyebrow="§7" title="Cost / efficiency">
        <Card><p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{costEfficiencyNote}</p></Card>
      </Section>

      <Section eyebrow="§8" title="Anomalies & integrity">
        <Card>
          <ul className="flex flex-col gap-3">
            {anomalies.map((a, i) => (
              <li key={i} className="text-sm flex gap-2" style={{ color: "var(--ink-secondary)" }}>
                <span style={{ color: "var(--accent)" }}>▸</span>
                {a}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section eyebrow="§9" title="Owner action list">
        <Card>
          <ol className="flex flex-col gap-3 list-decimal list-inside">
            {ownerActionList.map((a, i) => (
              <li key={i} className="text-sm" style={{ color: "var(--ink-secondary)" }}>{a}</li>
            ))}
          </ol>
        </Card>
        <Card className="!p-0 overflow-hidden mt-4">
          <div className="kb-table-wrap">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Model</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>Current total</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>If provisional → 0</th>
                  <th className="text-left px-4 py-3" style={{ color: "var(--ink-tertiary)" }}>If provisional → 10</th>
                </tr>
              </thead>
              <tbody>
                {provisionalSwing.map((row) => (
                  <tr key={row.model} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-4 py-3 font-medium" style={{ color: modelColorVar[row.model] }}>{modelShortName[row.model]}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ink)" }}>{row.current.toFixed(3)}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ink-tertiary)" }}>{row.ifZero.toFixed(3)}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--ink-tertiary)" }}>{row.ifTen.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </div>
  );
}
