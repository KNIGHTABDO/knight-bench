import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { tasks } from "../data/tasks";
import { categoryById } from "../data/categories";
import { masterScoreTable } from "../data/report";
import { models } from "../data/models";
import { modelColorVar, modelOrder, modelShortName } from "../data/modelVisuals";
import type { ModelId } from "../data/types";
import { Card, Section, StatusChip } from "../components/ui";
import { RemoteMarkdown } from "../components/RemoteMarkdown";

const artifactLabels = {
  output: "Raw model output",
  scorecard: "Scorecard",
  evidence: "Auto-check evidence",
} as const;
type Artifact = keyof typeof artifactLabels;

function artifactSrc(model: ModelId, taskId: string, artifact: Artifact) {
  const resultsDir = models.find((m) => m.id === model)!.resultsDir;
  if (artifact === "output") return `/data/results/${resultsDir}/task-${taskId}.md`;
  if (artifact === "scorecard") return `/data/judging/scorecards/${model}/task-${taskId}.md`;
  return `/data/judging/evidence/${model}/${taskId}-checks.md`;
}

const allModelIds = models.map((m) => m.id);
const isJudged = (m: ModelId) => models.find((x) => x.id === m)!.judged;

export default function TaskDetail() {
  const { id } = useParams();
  const task = id ? tasks.find((t) => t.id === id) : undefined;
  const [activeModel, setActiveModel] = useState<ModelId>("gemini");
  const [artifact, setArtifact] = useState<Artifact>("output");
  // Unjudged models have raw output only — no scorecard or evidence files.
  const effectiveArtifact = isJudged(activeModel) ? artifact : "output";

  if (!task || !id) return <Navigate to="/categories" replace />;
  const category = categoryById(task.categoryId);
  const row = masterScoreTable.find((r) => r.taskId === id)!;

  const idx = tasks.findIndex((t) => t.id === id);
  const prev = tasks[idx - 1];
  const next = tasks[idx + 1];

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link to={`/categories/${category.id}`} className="text-xs font-medium" style={{ color: "var(--ink-tertiary)" }}>
          ← {category.name}
        </Link>
        <div className="flex gap-3 text-xs" style={{ color: "var(--ink-tertiary)" }}>
          {prev && <Link to={`/tasks/${prev.id}`} style={{ color: "var(--accent)" }}>← {prev.id}</Link>}
          {next && <Link to={`/tasks/${next.id}`} style={{ color: "var(--accent)" }}>{next.id} →</Link>}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          Task {task.id} · Category {category.id} · {category.name}
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: "var(--ink)" }}>{task.title}</h1>
        <span className="text-xs" style={{ color: "var(--ink-tertiary)" }}>Estimated tokens: {task.estimatedTokens}</span>
      </div>

      <Section eyebrow="Scores" title="Result by model">
        <div className="grid sm:grid-cols-3 gap-3">
          {modelOrder.map((m) => {
            const s = row[m];
            return (
              <button
                key={m}
                onClick={() => setActiveModel(m)}
                className="glass rounded-[var(--radius-lg)] p-4 flex flex-col gap-2 text-left transition-transform active:scale-[0.98]"
                style={{
                  outline: activeModel === m ? `2px solid ${modelColorVar[m]}` : "none",
                  outlineOffset: "2px",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: modelColorVar[m] }} />
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{modelShortName[m]}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{s.score}</span>
                  <span className="text-sm" style={{ color: "var(--ink-tertiary)" }}>/ 10</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={s.status} />
                  <span className="text-xs tabular-nums" style={{ color: "var(--ink-tertiary)" }}>
                    auto-checks {s.autoChecksPassed}/{s.autoChecksTotal}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section eyebrow="Prompt" title="Exact copy-paste prompt given to every model">
        <Card className="!p-0 overflow-hidden">
          <pre className="!m-0 !rounded-none !border-0 whitespace-pre-wrap text-[13px] leading-relaxed p-5" style={{ color: "var(--ink)" }}>
            {task.prompt}
          </pre>
        </Card>
      </Section>

      <Section eyebrow="Rubric" title="0–10 scoring bands">
        <div className="grid gap-3">
          {task.rubric.map((band) => (
            <Card key={band.range} className="!py-4 flex flex-col sm:flex-row gap-2 sm:gap-4">
              <span
                className="shrink-0 text-sm font-semibold rounded-full px-3 py-1 h-fit"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {band.range}
              </span>
              <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>{band.text}</p>
            </Card>
          ))}
        </div>
        {task.bluffPenalty && (
          <Card tint className="mt-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--error)" }}>Bluff / honesty penalty</span>
            <p className="text-sm mt-1" style={{ color: "var(--ink-secondary)" }}>{task.bluffPenalty}</p>
          </Card>
        )}
        {task.scoringFormula && (
          <Card tint className="mt-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>Scoring formula</span>
            <p className="text-sm mt-1" style={{ color: "var(--ink-secondary)" }}>{task.scoringFormula}</p>
          </Card>
        )}
      </Section>

      <Section eyebrow="Auto-checks" title="Mechanical checklist">
        <Card>
          <ul className="flex flex-col gap-2">
            {task.autoChecks.map((c, i) => (
              <li key={i} className="text-sm flex gap-2" style={{ color: "var(--ink-secondary)" }}>
                <span style={{ color: "var(--accent)" }}>☐</span>
                {c}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        eyebrow="Evidence"
        title="Raw output, scorecard & evidence"
        action={
          <div className="flex gap-1.5 flex-wrap">
            {allModelIds.map((m) => (
              <button
                key={m}
                onClick={() => setActiveModel(m)}
                className="text-xs font-medium rounded-full px-3 py-1.5 transition-colors"
                style={{
                  background: activeModel === m ? modelColorVar[m] : "var(--bg-hover)",
                  color: activeModel === m ? "var(--accent-ink)" : "var(--ink-secondary)",
                }}
              >
                {modelShortName[m]}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex gap-1.5 mb-1">
          {(Object.keys(artifactLabels) as Artifact[])
            .filter((a) => a === "output" || isJudged(activeModel))
            .map((a) => (
            <button
              key={a}
              onClick={() => setArtifact(a)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition-colors"
              style={{
                background: effectiveArtifact === a ? "var(--accent-soft)" : "transparent",
                color: effectiveArtifact === a ? "var(--accent)" : "var(--ink-tertiary)",
                border: `1px solid ${effectiveArtifact === a ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              {artifactLabels[a]}
            </button>
          ))}
          {!isJudged(activeModel) && (
            <span className="text-xs self-center" style={{ color: "var(--warn)" }}>Judging pending — raw output only</span>
          )}
        </div>
        <Card>
          <RemoteMarkdown key={`${activeModel}-${effectiveArtifact}-${id}`} src={artifactSrc(activeModel, id, effectiveArtifact)} />
        </Card>
      </Section>
    </div>
  );
}
