import { Link } from "react-router-dom";
import { categories } from "../data/categories";
import { tasksByCategory } from "../data/tasks";
import { modelColorVar, modelShortName } from "../data/modelVisuals";
import { Crown, Section } from "../components/ui";

export default function Categories() {
  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="9 categories · 26 tasks" title="Every category, weighted">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          Weights sum to 100% and drive the headline score. Categories 2, 5.3, and 8.2 remain
          medical-provisional; category 4 is design-provisional, blind-judged, pending owner review.
        </p>
      </Section>
      <div className="grid gap-4">
        {categories.map((c) => {
          const tasks = tasksByCategory(c.id);
          return (
            <Link
              key={c.id}
              to={`/categories/${c.id}`}
              className="glass rounded-[var(--radius-lg)] p-5 flex flex-col sm:flex-row sm:items-center gap-4 transition-transform hover:-translate-y-0.5"
            >
              <div
                className="w-12 h-12 shrink-0 rounded-[var(--radius-md)] flex items-center justify-center text-lg font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {c.id}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" style={{ color: "var(--ink)" }}>{c.name}</span>
                  <span
                    className="text-[11px] font-medium rounded-full px-2 py-0.5"
                    style={{ background: "var(--bg-hover)", color: "var(--ink-tertiary)" }}
                  >
                    weight {c.weightPercent}%
                  </span>
                </div>
                <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--ink-secondary)" }}>{c.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tasks.map((t) => (
                    <span
                      key={t.id}
                      className="text-[11px] rounded-full px-2 py-0.5"
                      style={{ background: "var(--bg-hover)", color: "var(--ink-secondary)" }}
                    >
                      {t.id}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-sm shrink-0" style={{ color: modelColorVar[c.winner] }}>
                <Crown />
                {modelShortName[c.winner]}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
