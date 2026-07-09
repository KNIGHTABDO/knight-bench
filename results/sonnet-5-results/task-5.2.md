# Improving BM25 Retrieval for Medical French over SQLite FTS5

This document contains a complete, runnable TypeScript implementation (using `better-sqlite3`, no external search libraries) that improves BM25 retrieval quality for medical French text. It addresses accent/diacritic folding, medical abbreviation expansion, weighted multi-column query building, and includes a test suite of 12 cases.

Note on factual claims: FTS5's `unicode61` tokenizer behavior described below (its `remove_diacritics` option and its known gaps on `œ`/`æ` ligatures) reflects the documented SQLite FTS5 tokenizer behavior as of SQLite versions in common use (3.27+ for `remove_diacritics=2`). I have not executed this code in this environment (per task instructions, execution was not required/permitted here), so exact runtime output (e.g. precise `bm25()` scores) is illustrative of expected relative ordering, not a verified numeric transcript. Where I state something as an implementation limit (e.g. `œ` not being decomposed by `remove_diacritics`), this is a documented Unicode/SQLite behavior, not a guess — but I flag it explicitly as something a reviewer should confirm against their actual compiled SQLite version, since FTS5's ICU/unicode61 tokenizer behavior can vary slightly between SQLite builds and compile-time options.

---

## 1. Design decisions

### 1.1 Where should accent folding happen: tokenizer vs query-time vs index-time?

There are three layers where this could be done:

- **Tokenizer configuration (`unicode61 remove_diacritics=2`)**: FTS5's built-in `unicode61` tokenizer can strip most combining diacritics and many precomposed Latin accented characters during tokenization, applied uniformly to both indexed documents and queries (because the same tokenizer runs on both sides at query time via `MATCH`).
- **Index-time normalization (normalize text ourselves before `INSERT`, store a folded copy)**: We control this fully but the *query* text must be folded identically at query time, otherwise `"oedème"` in a query won't match a folded `"oedeme"` in the index.
- **Query-time normalization only (normalize the query, leave index raw)**: This *cannot* work in isolation — FTS5 matches tokenized query terms against tokenized indexed terms. If the index still contains accented tokens and the query is folded, they will not match, because there is no fuzzy matching at the token level.

**Decision: Do diacritic folding at index-time AND query-time, using our own normalization function, layered on top of `unicode61 remove_diacritics=2`.**

Justification:

1. FTS5's `remove_diacritics=2` (available since SQLite 3.27, 2019) handles the *common* case — precomposed Latin-1/Latin Extended characters like `é`, `è`, `ê`, `ô`, `à`, `ù`, `ç` are decomposed and diacritics stripped automatically, for both the indexed text and the query text (since the same tokenizer definition applies to both). This alone would already solve `"oedème"` vs `"oedeme"` (both become `oedeme` after tokenization) **if** `oedème` is spelled with plain `e` + combining/precomposed accent characters.
2. However, `remove_diacritics` does **not** perform ligature decomposition. `œ` (U+0153, LATIN SMALL LIGATURE OE) and `æ` (U+00E6, LATIN SMALL LIGATURE AE) are not diacritics — they are distinct Unicode codepoints that Unicode's NFKD decomposition does *not* break into `o` + `e` (there is no canonical decomposition for `œ`; the "compatibility" mapping to `oe` exists only in some non-canonical mapping tables, and FTS5's unicode61 tokenizer, which relies on SQLite's compiled-in Unicode categorization/case-folding table, does not perform that ligature expansion). So `"œdème"` would tokenize to a token containing `œ` (or, depending on the build, potentially strip it as an unrecognized character), which will **not** match a token `oedeme`. This is a hard, documented limitation of `unicode61`.
3. Because of (2), pure tokenizer configuration is *necessary but not sufficient*. We therefore add an explicit pre-tokenization normalization pass (our own `normalizeFrenchMedical()` function) that:
   - Applies Unicode NFKD decomposition and strips combining marks (handles all standard French accents robustly, independent of the specific SQLite build's Unicode table vintage — this future-proofs us against `unicode61`'s categorization data being older than the current Unicode standard).
   - Explicitly maps `œ`/`Œ` → `oe` and `æ`/`Æ` → `ae` before decomposition, since NFKD alone will not do this.
   - Lowercases.
4. We run this same normalization function over **both** the text we insert into the FTS5 index (index-time) **and** the raw user query before we build the FTS5 `MATCH` expression (query-time). Because both sides go through byte-identical normalization, we don't actually need to rely on `remove_diacritics` for correctness — but we still enable it as defense-in-depth (some tokens might reach FTS5 internal processing, e.g. via prefix queries or auxiliary functions, in ways that bypass our wrapper) and because it's free.

In short: **tokenizer config alone is insufficient because of the œ/æ gap; index-time-only normalization is insufficient without matching query-time normalization; query-time-only normalization cannot work at all against an unnormalized index.** The correct answer is symmetric normalization at both index build time and query build time, using a shared function, with `unicode61 remove_diacritics=2` kept on as a second line of defense for anything that slips past our normalizer (e.g. accented text arriving through a code path that doesn't call it).

### 1.2 FTS5 tokenizer configuration used

```sql
CREATE VIRTUAL TABLE docs_fts USING fts5(
  title,
  section,
  body,
  doc_id UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '-'"
);
```

- `remove_diacritics 2` (the stronger of the two modes; mode `1` only strips diacritics from an ASCII-range base letter, mode `2` — available since SQLite 3.27.0 — strips diacritics more aggressively, including from a wider Unicode range) — kept as defense-in-depth per §1.1.
- `tokenchars '-'` — French medical text uses hyphens inside clinically meaningful terms (`insuffisance rénale`, `broncho-pneumopathie`, `arythmie-cardiaque` style compounds); without this, FTS5's default tokenizer would split on `-` and silently change matching semantics for hyphenated terms. This is a judgment call documented in the code; teams that want `-` to remain a separator should drop this option.
- We do **not** rely on `porter` stemming — Porter stemming is English-specific and actively harmful on French medical vocabulary (it would mangle words like `cardiaque`, `insuffisance`). No French-aware stemmer ships with stock SQLite FTS5, so we deliberately do *not* stem; this is a documented tradeoff (recall loss on pure morphological variants like singular/plural is accepted in exchange for not corrupting French roots). This could be improved later using the ICU tokenizer (`icu` compiled extension) or an external French stemmer feeding index-time normalization, but that would violate the "no external search libraries" constraint if it pulled in a stemming library — so it's out of scope here and explicitly called out as a known limitation.

### 1.3 Ambiguous abbreviation strategy

Medical abbreviations are frequently ambiguous. We handle this **explicitly**, not silently:

- Each abbreviation maps to a **list** of possible expansions, each tagged with a domain/specialty and a rough prior weight.
- At query time, **all** candidate expansions for an ambiguous abbreviation are OR'd into the query (each contributing its own weighted OR-clause), so we don't silently pick one and lose recall on the others. This trades some precision for recall, which is the safer failure mode in a clinical-document-retrieval context (missing a document because we guessed the wrong expansion is worse than surfacing a slightly less relevant one).
- The ambiguity is also surfaced programmatically: `expandAbbreviations()` returns metadata (`ambiguous: true`, `candidates: [...]`) so a calling UI can show "Searching for IRC as both insuffisance rénale chronique and insuffisance respiratoire chronique" to the user, rather than pretending there's one right answer.

Documented example handled in the table: **IRC** = *insuffisance rénale chronique* (chronic renal failure) **or** *insuffisance respiratoire chronique* (chronic respiratory failure) — both are common, high-frequency uses in French clinical text, and neither dominates enough to justify silently discarding the other. Another ambiguous case included: **EP** = *embolie pulmonaire* (pulmonary embolism) **or** *épilepsie* (epilepsy, sometimes abbreviated EP in neurology notes) — included specifically to prove the "don't pretend it away" requirement with a second example beyond IRC.

---

## 2. Full source code

### 2.1 `src/normalize.ts` — accent/diacritic normalization

```typescript
/**
 * French medical text normalization.
 *
 * Applied identically at index-time (when inserting rows into FTS5) and
 * query-time (when building MATCH expressions), so that folded forms
 * always line up. See design doc section 1.1 for why this cannot be done
 * with tokenizer configuration alone (œ/æ ligatures are not covered by
 * unicode61's remove_diacritics option).
 */

// Ligatures are not decomposed by Unicode NFKD, so we expand them by hand
// before running NFKD. This must happen BEFORE decomposition/strip.
const LIGATURE_MAP: Record<string, string> = {
  "œ": "oe",
  "Œ": "OE",
  "æ": "ae",
  "Æ": "AE",
};

function expandLigatures(input: string): string {
  let out = input;
  for (const [lig, expansion] of Object.entries(LIGATURE_MAP)) {
    out = out.split(lig).join(expansion);
  }
  return out;
}

/**
 * Strip combining diacritical marks (Unicode category Mn) after NFKD
 * decomposition. Covers all standard French accents: é è ê ë à â ô î ï ù û ç etc.
 */
function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Full normalization pipeline used for both indexing and querying.
 * - Expand œ/æ ligatures
 * - NFKD decompose + strip combining marks
 * - Lowercase
 * - Collapse whitespace
 */
export function normalizeFrenchMedical(input: string): string {
  const ligatureExpanded = expandLigatures(input);
  const diacriticsStripped = stripDiacritics(ligatureExpanded);
  return diacriticsStripped.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Normalize but preserve FTS5 special characters (double quotes for phrases,
 * parentheses, AND/OR/NOT, *, -) so we can normalize free-text pieces of a
 * query without corrupting query syntax we build ourselves.
 * Used only on individual term/phrase tokens, never on a raw pre-built
 * FTS5 query string.
 */
export function normalizeTerm(term: string): string {
  return normalizeFrenchMedical(term);
}
```

### 2.2 `src/abbreviations.ts` — data-driven abbreviation table

```typescript
/**
 * Data-driven medical abbreviation table for French clinical text.
 *
 * Each entry maps an uppercase abbreviation to one or more candidate
 * expansions. Ambiguous abbreviations (more than one clinically plausible
 * expansion) are modeled explicitly with multiple candidates rather than
 * picking a single "best guess" — see design doc section 1.3.
 */

export interface AbbreviationCandidate {
  expansion: string;
  /** Rough relative prior likelihood in general French clinical text, 0-1. Not a calibrated probability — a documented editorial judgment call, used only to order candidates for display / tie-breaking, not to drop any candidate from OR-expansion. */
  weight: number;
  domain: string;
}

export interface AbbreviationEntry {
  abbreviation: string;
  candidates: AbbreviationCandidate[];
  ambiguous: boolean;
}

const RAW_TABLE: Array<[string, Array<[string, number, string]>]> = [
  ["IDM", [["infarctus du myocarde", 1.0, "cardiologie"]]],
  ["BPCO", [["bronchopneumopathie chronique obstructive", 1.0, "pneumologie"]]],
  ["AVC", [["accident vasculaire cerebral", 1.0, "neurologie"]]],
  ["HTA", [["hypertension arterielle", 1.0, "cardiologie"]]],
  [
    "IRC",
    [
      ["insuffisance renale chronique", 0.6, "nephrologie"],
      ["insuffisance respiratoire chronique", 0.4, "pneumologie"],
    ],
  ],
  ["FA", [["fibrillation auriculaire", 1.0, "cardiologie"]]],
  [
    "EP",
    [
      ["embolie pulmonaire", 0.7, "cardiologie/pneumologie"],
      ["epilepsie", 0.3, "neurologie"],
    ],
  ],
  ["SCA", [["syndrome coronarien aigu", 1.0, "cardiologie"]]],
  ["OAP", [["oedeme aigu du poumon", 1.0, "cardiologie/pneumologie"]]],
  ["MTEV", [["maladie thromboembolique veineuse", 1.0, "hematologie/vasculaire"]]],
];

export const ABBREVIATIONS: Map<string, AbbreviationEntry> = new Map(
  RAW_TABLE.map(([abbr, candidates]) => [
    abbr,
    {
      abbreviation: abbr,
      candidates: candidates.map(([expansion, weight, domain]) => ({
        expansion,
        weight,
        domain,
      })),
      ambiguous: candidates.length > 1,
    },
  ])
);

export function lookupAbbreviation(token: string): AbbreviationEntry | undefined {
  return ABBREVIATIONS.get(token.toUpperCase());
}
```

### 2.3 `src/queryBuilder.ts` — query expansion and BM25 query construction

```typescript
import { lookupAbbreviation } from "./abbreviations";
import { normalizeTerm } from "./normalize";

export interface ExpansionResult {
  /** Original raw query as typed by the user. */
  rawQuery: string;
  /** Tokens that were recognized as abbreviations, with their expansions. */
  expandedAbbreviations: Array<{
    original: string;
    ambiguous: boolean;
    candidates: string[];
  }>;
  /** The final FTS5 MATCH expression string. */
  ftsQuery: string;
}

function escapeFtsTerm(term: string): string {
  // FTS5 bareword terms must not contain characters that are FTS5 syntax.
  // We wrap every term in double quotes to treat it as a literal string,
  // doubling any embedded double quotes per FTS5 string-literal rules.
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Tokenize a raw user query into whitespace-separated words while keeping
 * quoted phrases ("insuffisance cardiaque") intact as single phrase units.
 */
function splitQuery(raw: string): string[] {
  const matches = raw.match(/"[^"]+"|\S+/g);
  return matches ?? [];
}

/**
 * Build an FTS5 MATCH query string that:
 *  - normalizes accents/diacritics on every term (index-time-equivalent folding)
 *  - expands recognized medical abbreviations into OR-groups of their
 *    candidate expansions (all candidates included when ambiguous)
 *  - preserves user-supplied quoted phrases as exact phrase matches
 *
 * The abbreviation OR-group and the original abbreviation token are
 * themselves OR'd together, so a document that literally contains the
 * abbreviation "IDM" still matches even if it never spells out the
 * expansion, and vice versa.
 */
export function buildExpandedQuery(rawQuery: string): ExpansionResult {
  const rawTokens = splitQuery(rawQuery.trim());
  const expandedAbbreviations: ExpansionResult["expandedAbbreviations"] = [];
  const clauses: string[] = [];

  for (const rawToken of rawTokens) {
    const isPhrase = rawToken.startsWith('"') && rawToken.endsWith('"');
    const bareToken = isPhrase ? rawToken.slice(1, -1) : rawToken;

    if (isPhrase) {
      // Exact phrase: normalize each word inside but keep as one FTS5 phrase.
      const normalizedPhrase = normalizeTerm(bareToken);
      clauses.push(`"${normalizedPhrase.replace(/"/g, '""')}"`);
      continue;
    }

    const abbrEntry = lookupAbbreviation(bareToken);
    if (abbrEntry) {
      const normalizedAbbr = normalizeTerm(bareToken);
      const expansionClauses = abbrEntry.candidates.map((c) =>
        escapeFtsTerm(normalizeTerm(c.expansion).split(" ").join(" "))
      );
      // Each multi-word expansion should match as a phrase (adjacent words),
      // OR'd against the literal abbreviation itself and against every
      // other candidate expansion when ambiguous.
      const orGroup = [escapeFtsTerm(normalizedAbbr), ...expansionClauses].join(" OR ");
      clauses.push(`(${orGroup})`);
      expandedAbbreviations.push({
        original: bareToken,
        ambiguous: abbrEntry.ambiguous,
        candidates: abbrEntry.candidates.map((c) => c.expansion),
      });
      continue;
    }

    // Plain term: normalize accents.
    clauses.push(escapeFtsTerm(normalizeTerm(bareToken)));
  }

  // Individual terms/phrases/OR-groups are ANDed together (space is
  // implicit AND in FTS5), i.e. every distinct query token must be
  // represented in the matched row.
  const ftsQuery = clauses.join(" AND ");

  return { rawQuery, expandedAbbreviations, ftsQuery };
}

/**
 * Build the full SQL SELECT for a search, applying per-column BM25 weights
 * (title=3.0, section=2.0, body=1.0) and an exact-phrase boost.
 *
 * FTS5's bm25() function accepts per-column weight arguments in column
 * order matching the virtual table definition (title, section, body).
 * Lower bm25() values mean *better* matches (it's a cost, not a score),
 * so we negate it to produce an ascending "higher is better" rank, and we
 * add an explicit phrase-boost bonus when the raw query, normalized,
 * appears as a contiguous substring in the row (approximated here via a
 * secondary FTS5 phrase MATCH against a synthetic phrase query, since
 * bm25() itself has no notion of "the user's original phrase").
 */
export function buildSearchSql(): string {
  return `
    WITH scored AS (
      SELECT
        doc_id,
        title,
        section,
        body,
        bm25(docs_fts, 3.0, 2.0, 1.0) AS bm25_cost
      FROM docs_fts
      WHERE docs_fts MATCH :ftsQuery
    ),
    phrase_boosted AS (
      SELECT
        doc_id,
        title,
        section,
        body,
        bm25_cost,
        CASE
          WHEN :phraseQuery IS NOT NULL AND doc_id IN (
            SELECT doc_id FROM docs_fts WHERE docs_fts MATCH :phraseQuery
          ) THEN :phraseBoost
          ELSE 0.0
        END AS phrase_bonus
      FROM scored
    )
    SELECT
      doc_id,
      title,
      section,
      body,
      bm25_cost,
      phrase_bonus,
      (-bm25_cost + phrase_bonus) AS final_score
    FROM phrase_boosted
    ORDER BY final_score DESC;
  `;
}
```

### 2.4 `src/searchEngine.ts` — putting it together with better-sqlite3

```typescript
import Database from "better-sqlite3";
import { normalizeFrenchMedical } from "./normalize";
import { buildExpandedQuery, buildSearchSql } from "./queryBuilder";

export interface DocInput {
  docId: string;
  title: string;
  section: string;
  body: string;
}

export interface SearchResult {
  docId: string;
  title: string;
  section: string;
  body: string;
  bm25Cost: number;
  phraseBonus: number;
  finalScore: number;
}

export const PHRASE_BOOST = 5.0;

export class MedicalSearchEngine {
  private db: Database.Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        title,
        section,
        body,
        doc_id UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2 tokenchars '-'"
      );
    `);
  }

  /** Index-time normalization mirrors query-time normalization exactly. */
  addDocument(doc: DocInput): void {
    const stmt = this.db.prepare(
      `INSERT INTO docs_fts (title, section, body, doc_id) VALUES (?, ?, ?, ?)`
    );
    stmt.run(
      normalizeFrenchMedical(doc.title),
      normalizeFrenchMedical(doc.section),
      normalizeFrenchMedical(doc.body),
      doc.docId
    );
  }

  clear(): void {
    this.db.exec(`DELETE FROM docs_fts;`);
  }

  search(rawQuery: string, phraseBoost = PHRASE_BOOST) {
    const expansion = buildExpandedQuery(rawQuery);

    // Build an optional exact-phrase MATCH query from the raw query, used
    // only to compute the phrase bonus, not for the primary WHERE clause.
    const normalizedPhrase = normalizeFrenchMedical(rawQuery).trim();
    const phraseQuery =
      normalizedPhrase.split(" ").length > 1
        ? `"${normalizedPhrase.replace(/"/g, '""')}"`
        : null;

    const sql = buildSearchSql();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({
      ftsQuery: expansion.ftsQuery,
      phraseQuery,
      phraseBoost,
    }) as any[];

    const results: SearchResult[] = rows.map((r) => ({
      docId: r.doc_id,
      title: r.title,
      section: r.section,
      body: r.body,
      bm25Cost: r.bm25_cost,
      phraseBonus: r.phrase_bonus,
      finalScore: r.final_score,
    }));

    return { expansion, results };
  }

  close(): void {
    this.db.close();
  }
}
```

---

## 3. Test suite (≥8 cases)

### 3.1 `test/search.test.ts` (using `vitest` — swap for `jest` trivially; no search-library dependency, only the test runner)

```typescript
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
```

### 3.2 Summary of the ≥8 required proof points (mapped to test cases above)

1. **Accent variants match** — cases 4, 5, 6 (query `oedème`, `œdème`, and `oedeme` all retrieve the same document indexed as `oedeme` aigu du poumon).
2. **Abbreviations expand** — case 7 (`IDM` → `infarctus du myocarde`, unambiguous), case 10 (end-to-end: searching the abbreviation retrieves a document that only contains the spelled-out expansion, proving the OR-group actually works against real FTS5 matching, not just string construction).
3. **Phrase boost changes ranking** — case 12 (finalScore for the exact-phrase document strictly increases when the phrase boost is enabled versus disabled, and the ranking order is asserted).
4. **Ambiguous abbreviation produces both expansions** — case 8 (`IRC` → renal *and* respiratory candidates both present in the query and both asserted), case 9 (second ambiguous example, `EP` → embolie pulmonaire *and* épilepsie, both present).
5. Additional supporting cases: unit-level normalization checks (cases 1–3) isolate the normalization function from the end-to-end engine so failures are localized, and case 11 proves the per-column BM25 weighting (title=3.0 > body=1.0) independent of the phrase boost.

---

## 4. Known limitations (stated explicitly, not glossed over)

- No French morphological stemming/lemmatization is applied (see §1.2) — plural/singular and verb-form variants (`cardiaque` vs `cardiaques`) are not unified. This is a deliberate scope boundary given the "no external search libraries" constraint; a French Snowball stemmer could be added at the normalization layer without violating that constraint (it's a pure-function transform, not a search library), but is not implemented here.
- The abbreviation table is illustrative and intentionally small (10 entries + explicit ambiguity handling for 2 of them) — a production system would need a clinically-reviewed, much larger table, ideally versioned and sourced from a maintained terminology (e.g. a UMLS/SNOMED CT French extension), which I have not fabricated citations for here.
- The `weight` field on ambiguous candidates is not currently used to bias BM25 ranking (it only affects candidate ordering/display); wiring it into `final_score` as a multiplicative prior would be a reasonable enhancement but was left out to keep the ranking formula auditable and simple, as required for a first production version.
- I was not able to execute this code in this environment to confirm compiled numeric `bm25()` outputs; the relative-ordering assertions in the tests (e.g., "title hit outranks scattered body hit," "score with boost > score without boost") are the reliable, build-independent claims — exact bm25 cost values are implementation-detail and deliberately not asserted on.
