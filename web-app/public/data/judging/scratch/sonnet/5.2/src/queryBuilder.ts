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
