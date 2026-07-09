import { Link } from "react-router-dom";
import { categories } from "../data/categories";
import { judgedModels, models } from "../data/models";
import { executiveVerdict, conflictStatement, scopeNote } from "../data/report";
import { modelColorVar, modelShortName } from "../data/modelVisuals";
import { Card, Section, Crown } from "../components/ui";
import { WeightedTotalBars } from "../components/WeightedTotalBars";
import { CategoryBarChart } from "../components/CategoryBarChart";

export default function Overview() {
  const winner = models.find((m) => m.id === executiveVerdict.winner)!;

  return (
    <div className="flex flex-col gap-16">
      <section className="fade-up flex flex-col gap-6 pt-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          v1 · 9 categories · 26 tasks · 3 models judged, 78 outputs scored · 1 raw run pending judging
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold leading-[1.08] max-w-3xl" style={{ color: "var(--ink)" }}>
          A personal, reproducible benchmark for frontier models against real workloads.
        </h1>
        <p className="text-base max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          Agentic coding, French/EDN medical reasoning, RTL/Arabic engineering, design taste,
          medical RAG, streaming infra, agent orchestration, long-context instruction following,
          and cost-efficiency — scored against explicit 0–10 rubrics and mechanical auto-checks,
          not vibes.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to="/report"
            className="inline-flex items-center h-11 px-6 rounded-full text-sm font-medium"
            style={{
              background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 85%, white), var(--accent))",
              color: "var(--accent-ink)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)",
            }}
          >
            Read the full judge report
          </Link>
          <Link
            to="/categories"
            className="glass inline-flex items-center h-11 px-6 rounded-full text-sm font-medium"
            style={{ color: "var(--ink)" }}
          >
            Browse the 9 categories
          </Link>
        </div>
      </section>

      <div className="glass-tint rounded-[var(--radius-lg)] p-5 flex flex-col gap-2 text-sm" style={{ color: "var(--ink-secondary)" }}>
        <div>
          <span className="font-semibold" style={{ color: "var(--warn)" }}>Conflict statement — </span>
          {conflictStatement}
        </div>
        <div>
          <span className="font-semibold" style={{ color: "var(--warn)" }}>Scope note — </span>
          {scopeNote}
        </div>
      </div>

      <Section eyebrow="Executive verdict" title={`Overall winner: ${winner.name}`}>
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          {executiveVerdict.summary} {executiveVerdict.personalityRead}
        </p>
        <Card>
          <WeightedTotalBars />
          <p className="text-xs mt-4" style={{ color: "var(--ink-tertiary)" }}>
            Weighted total = Σ (category mean × category weight), scored 0–10. Some tasks are still
            PROVISIONAL pending owner medical/design review — see the swing range on the Judge Report page.
          </p>
        </Card>
      </Section>

      <Section eyebrow="Per model" title="Headline numbers">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {judgedModels.map((m) => (
            <div key={m.id} className="glass rounded-[var(--radius-lg)] p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: modelColorVar[m.id] }} />
                <span className="font-medium text-sm" style={{ color: "var(--ink)" }}>{m.name}</span>
              </div>
              <div className="text-3xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                {m.weightedTotal.toFixed(3)}
              </div>
              <div className="text-xs" style={{ color: "var(--ink-tertiary)" }}>
                FINAL-only normalized: {m.finalOnlyNormalized.toFixed(3)} · settled contribution {m.settledContribution.toFixed(3)}
              </div>
              <Link
                to={`/models/${m.id}`}
                className="text-xs font-medium mt-1"
                style={{ color: "var(--accent)" }}
              >
                View model detail →
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Category winners" title="Who wins each category">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {categories.map((c) => (
            <Link
              key={c.id}
              to={`/categories/${c.id}`}
              className="glass rounded-[var(--radius-lg)] p-4 flex flex-col gap-2 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: "var(--ink-tertiary)" }}>
                  Category {c.id} · {c.weightPercent}%
                </span>
              </div>
              <div className="font-medium text-sm" style={{ color: "var(--ink)" }}>{c.name}</div>
              <div className="flex items-center gap-1.5 text-sm mt-1" style={{ color: modelColorVar[c.winner] }}>
                <Crown />
                {modelShortName[c.winner]}
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section eyebrow="Score matrix" title="Category scores, all 3 models">
        <Card>
          <CategoryBarChart />
        </Card>
      </Section>
    </div>
  );
}
