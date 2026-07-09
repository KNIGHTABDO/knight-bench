import { Link } from "react-router-dom";
import { Card, Section } from "../components/ui";
import { RemoteMarkdown } from "../components/RemoteMarkdown";

export default function Spec() {
  return (
    <div className="flex flex-col gap-8">
      <Section eyebrow="Source of truth" title="knight-bench-v1.md">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-secondary)" }}>
          The complete, unmodified benchmark specification: fairness rules, all 26 task prompts
          and rubrics, the scoring-spreadsheet structure, the judging protocol, and versioning
          rules. Everything elsewhere on this site is derived from this file and the judge report —
          this page renders the source document itself.
        </p>
        <div className="flex gap-3">
          <Link to="/report" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Judge report →</Link>
          <Link to="/design-review" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Blind design review →</Link>
          <Link to="/medical-review" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Medical review packet →</Link>
        </div>
      </Section>
      <Card>
        <RemoteMarkdown src="/data/knight-bench-v1.md" />
      </Card>
    </div>
  );
}
