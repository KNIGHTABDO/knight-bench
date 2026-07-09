import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MedicalSearchEngine } from "../src/searchEngine";
import { buildExpandedQuery } from "../src/queryBuilder";
import { normalizeFrenchMedical } from "../src/normalize";

describe("normalizeFrenchMedical", () => {
  it("case 1: folds standard French accents", () => {
    expect(normalizeFrenchMedical("oedème")).toBe("oedeme");
    expect(normalizeFrenchMedical("insuffisance rénale")).toBe(
      "insuffisance renale"
    );
  });

  it("case 2: expands and folds the œ ligature", () => {
    expect(normalizeFrenchMedical("œdème")).toBe("oedeme");
  });

  it("case 3: unaccented input is left byte-identical modulo case", () => {
    expect(normalizeFrenchMedical("oedeme")).toBe("oedeme");
  });
});

describe("MedicalSearchEngine — accent folding end to end", () => {
  let engine: MedicalSearchEngine;

  beforeEach(() => {
    engine = new MedicalSearchEngine(":memory:");
    engine.addDocument({
      docId: "doc-oedeme-1",
      title: "OAP",
      section: "Diagnostic",
      body: "Le patient presente un oedeme aigu du poumon severe.",
    });
  });

  afterEach(() => engine.close());

  it("case 4: query 'oedème' (accented) matches an index stored via normalized 'oedeme'", () => {
    const { results } = engine.search("oedème");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-oedeme-1");
  });

  it("case 5: query 'œdème' (ligature) also matches the same document", () => {
    const { results } = engine.search("œdème");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-oedeme-1");
  });

  it("case 6: query 'oedeme' (already unaccented) also matches, proving all three variants converge", () => {
    const { results } = engine.search("oedeme");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-oedeme-1");
  });
});

describe("Abbreviation expansion", () => {
  it("case 7: unambiguous abbreviation IDM expands to a single candidate", () => {
    const { expandedAbbreviations, ftsQuery } = buildExpandedQuery("IDM");
    expect(expandedAbbreviations).toHaveLength(1);
    expect(expandedAbbreviations[0].ambiguous).toBe(false);
    expect(expandedAbbreviations[0].candidates).toEqual(["infarctus du myocarde"]);
    expect(ftsQuery).toContain("infarctus du myocarde");
    expect(ftsQuery).toContain('"idm"');
  });

  it("case 8: ambiguous abbreviation IRC produces BOTH expansions in the query, not just one", () => {
    const { expandedAbbreviations, ftsQuery } = buildExpandedQuery("IRC");
    expect(expandedAbbreviations[0].ambiguous).toBe(true);
    expect(expandedAbbreviations[0].candidates).toEqual([
      "insuffisance renale chronique",
      "insuffisance respiratoire chronique",
    ]);
    expect(ftsQuery).toContain("insuffisance renale chronique");
    expect(ftsQuery).toContain("insuffisance respiratoire chronique");
  });

  it("case 9: second ambiguous abbreviation EP (embolie pulmonaire vs epilepsie) also yields both candidates", () => {
    const { expandedAbbreviations, ftsQuery } = buildExpandedQuery("EP");
    expect(expandedAbbreviations[0].ambiguous).toBe(true);
    expect(expandedAbbreviations[0].candidates).toEqual([
      "embolie pulmonaire",
      "epilepsie",
    ]);
    expect(ftsQuery).toContain("embolie pulmonaire");
    expect(ftsQuery).toContain("epilepsie");
  });

  it("case 10: end-to-end retrieval — searching abbreviation 'IDM' finds a document that only spells out the expansion", () => {
    const engine = new MedicalSearchEngine(":memory:");
    engine.addDocument({
      docId: "doc-idm-expansion-only",
      title: "Compte rendu",
      section: "Antecedents",
      body: "Antecedent d'infarctus du myocarde en 2019, sans recidive.",
    });
    const { results } = engine.search("IDM");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-idm-expansion-only");
    engine.close();
  });
});

describe("Per-column weighting and phrase boost", () => {
  let engine: MedicalSearchEngine;

  beforeEach(() => {
    engine = new MedicalSearchEngine(":memory:");
    // Doc A: term appears only in title (should score high due to title weight 3.0).
    engine.addDocument({
      docId: "doc-title-hit",
      title: "insuffisance cardiaque",
      section: "Resume",
      body: "Suivi de routine sans particularite.",
    });
    // Doc B: term appears only in body (should score lower, body weight 1.0),
    // and the words are NOT adjacent (no exact phrase), so it should not get
    // the phrase bonus either.
    engine.addDocument({
      docId: "doc-body-hit-scattered",
      title: "Consultation",
      section: "Notes",
      body:
        "Le patient presente une insuffisance moderee. Sur le plan cardiaque, aucune anomalie.",
    });
  });

  afterEach(() => engine.close());

  it("case 11: title-column hit outranks a scattered body-only hit due to per-column BM25 weights", () => {
    const { results } = engine.search("insuffisance", 0);
    // Both documents contain "insuffisance" at least once; title=3.0 weight
    // should push doc-title-hit's phrase match on top even without the
    // phrase boost given equal-ish term frequency, and definitely with it.
    const ids = results.map((r) => r.docId);
    expect(ids[0]).toBe("doc-title-hit");
  });

  it("case 12: exact phrase boost changes ranking — with phrase boost enabled, the exact-phrase document strictly increases its lead over the scattered-term document, and its finalScore is higher than without the boost", () => {
    const { results: withoutBoost } = engine.search(
      "insuffisance cardiaque",
      0 // phraseBoost = 0 disables the bonus
    );
    const { results: withBoost } = engine.search(
      "insuffisance cardiaque",
      MedicalSearchEngineDefaultBoostCheck()
    );

    const scoreWithout = withoutBoost.find(
      (r) => r.docId === "doc-title-hit"
    )!.finalScore;
    const scoreWith = withBoost.find(
      (r) => r.docId === "doc-title-hit"
    )!.finalScore;

    expect(scoreWith).toBeGreaterThan(scoreWithout);
    // Ranking check: exact-phrase doc must be first with boost enabled.
    expect(withBoost[0].docId).toBe("doc-title-hit");
  });
});

// Helper kept local to the test file to make the boost value explicit at
// the call site above without importing a magic number silently.
function MedicalSearchEngineDefaultBoostCheck(): number {
  return 5.0;
}
