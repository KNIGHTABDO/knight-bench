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
