import { Card, Section } from "../components/ui";
import { RemoteMarkdown } from "../components/RemoteMarkdown";

export default function MedicalReview() {
  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Categories 2 · 5.3 · 8.2" title="Medical / clinical review packet">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          Every medical verdict in this benchmark is provisional until the owner verifies it
          against current HAS/SPILF/collèges references — non-negotiable per the judging
          protocol. This packet lists every checkable clinical claim, quote, and threshold.
        </p>
      </Section>
      <Card>
        <RemoteMarkdown src="/data/judging/human-review/medical-review.md" />
      </Card>
      <Section eyebrow="Mechanical layer" title="Auto-check pass/fail, every model × task">
        <Card>
          <RemoteMarkdown src="/data/judging/mechanical-summary.md" />
        </Card>
      </Section>
    </div>
  );
}
