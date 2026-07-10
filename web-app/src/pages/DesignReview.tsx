import { Card, Section } from "../components/ui";
import { RemoteMarkdown } from "../components/RemoteMarkdown";

const files = ["A-4.1", "A-4.2", "A-4.3", "B-4.1", "B-4.2", "B-4.3", "C-4.1", "C-4.2", "C-4.3", "D-4.1", "D-4.2", "D-4.3", "E-4.1", "E-4.2", "E-4.3"];

export default function DesignReview() {
  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Category 4 · blind" title="Design review scoring sheet">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          Category 4 outputs are blind-packed under random IDs (A/B/C/D/E) before scoring — the
          model↔ID mapping is sealed in <code>mapping-sealed.md</code> and intentionally not
          surfaced here, so taste judging stays uncontaminated by lab style.
        </p>
      </Section>
      <Card>
        <RemoteMarkdown src="/data/judging/design-review/scoring-sheet.md" />
      </Card>
      <Section eyebrow="Sealed HTML files" title="Blind submissions (A/B/C/D/E × 4.1/4.2/4.3)">
        <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {files.map((f) => (
            <a
              key={f}
              href={`/data/judging/design-review/${f}.html`}
              target="_blank"
              rel="noreferrer"
              className="glass rounded-[var(--radius-lg)] p-4 flex items-center justify-between text-sm font-medium transition-transform hover:-translate-y-0.5"
              style={{ color: "var(--ink)" }}
            >
              {f}.html
              <span style={{ color: "var(--ink-tertiary)" }}>↗</span>
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
