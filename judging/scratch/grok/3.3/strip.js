/**
 * stripDiacritics(verse) — SEARCH INDEXING ONLY
 * Removes tashkeel/harakat and Quranic annotation marks.
 * Does NOT remove base letters, precomposed hamza/madda letters, or
 * combining madda/hamza (U+0653–U+0655); handle those in a dedicated
 * alef/hamza normalization step if you want them unified for search.
 *
 * NEVER use the result for on-screen Quran display.
 */
function stripDiacritics(verse) {
  if (verse == null || verse === "") return "";

  // Prefer canonical composition before deleting marks.
  let s = verse.normalize("NFC");

  // Explicit strip set:
  // - U+0610–U+061A  Arabic marks
  // - U+064B–U+0652  tanween, fatha, damma, kasra, shadda, sukun
  // - U+0656–U+065F  other marks in the harakat area EXCEPT 0653–0655
  // - U+0670         superscript alef
  // - U+06D6–U+06ED  Quranic annotations
  // - U+08D3–U+08FF  Arabic Extended-A (marks as present)
  // - U+0640         tatweel
  // - U+06DD, U+06DE ayah / rub markers if inlined
  //
  // NOT stripped here (examples of letter identity):
  // - U+0621 HAMZA
  // - U+0622 ALEF WITH MADDA ABOVE
  // - U+0623–U+0626 precomposed hamza-on-letter forms
  // - U+0653 MADDAH ABOVE, U+0654 HAMZA ABOVE, U+0655 HAMZA BELOW
  const STRIP_RE = /[\u0610-\u061A\u064B-\u0652\u0656-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640\u06DD\u06DE]/g;

  s = s.replace(STRIP_RE, "");

  // Collapse whitespace left by removed markers / editors.
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// --- Examples (illustrative) ---
// stripDiacritics("بِسْمِ ٱللَّهِ")
//   → retains base letters; removes fatha/kasra/shadda/sukun/wasla-mark as configured
//
// Must NOT turn "آ" (U+0622) into empty or into an unrelated letter by deleting the code point.
// Must NOT delete "ء" (U+0621) as if it were a haraka.

export { stripDiacritics };
