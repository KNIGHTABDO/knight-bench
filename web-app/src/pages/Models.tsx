import { Link } from "react-router-dom";
import { models, modelsUnderTestV1 } from "../data/models";
import { modelColorVar } from "../data/modelVisuals";
import { Card, Section } from "../components/ui";
import { WeightedTotalBars } from "../components/WeightedTotalBars";

export default function Models() {
  return (
    <div className="flex flex-col gap-10">
      <Section eyebrow="This run" title="3 models judged, 78 outputs scored · Muse Spark 1.1 raw run complete, judging pending">
        <Card>
          <WeightedTotalBars />
        </Card>
      </Section>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {models.map((m) => (
          <Link key={m.id} to={`/models/${m.id}`} className="glass rounded-[var(--radius-lg)] p-5 flex flex-col gap-3 transition-transform hover:-translate-y-0.5">
            <span className="w-3 h-3 rounded-full" style={{ background: modelColorVar[m.id] }} />
            <span className="font-medium" style={{ color: "var(--ink)" }}>{m.name}</span>
            {m.judged ? (
              <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{m.weightedTotal.toFixed(3)}</span>
            ) : (
              <span className="text-sm font-medium" style={{ color: "var(--warn)" }}>Judging pending</span>
            )}
            <span className="text-xs" style={{ color: "var(--ink-tertiary)" }}>results/{m.resultsDir}/</span>
          </Link>
        ))}
      </div>

      <Section eyebrow="From the spec" title="All models under test in KNIGHT-BENCH v1">
        <Card tint>
          <p className="text-sm mb-3" style={{ color: "var(--ink-secondary)" }}>
            Not every model listed in the spec has been run yet in this cycle — the four above have saved results; Muse Spark 1.1 has raw outputs only (26/26) and is awaiting judging.
          </p>
          <div className="flex flex-wrap gap-2">
            {modelsUnderTestV1.map((name) => (
              <span key={name} className="text-xs rounded-full px-3 py-1" style={{ background: "var(--bg-hover)", color: "var(--ink-secondary)" }}>
                {name}
              </span>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}
