/**
 * Strip Quranic diacritics (tashkeel/harakat) and annotation marks from a verse
 * for SEARCH INDEXING ONLY. Do NOT use the output for display.
 *
 * Removes (Unicode ranges / individual code points):
 *
 *  U+0610–U+061A  Arabic honorifics / Quranic annotation signs
 *                 (sallallahou alayhe wassallam, alayhe salaam, small high marks
 *                  used as recitation signs, etc.)
 *  U+064B–U+065F  Arabic combining diacritics: fathatan, dammatan, kasratan,
 *                 fatha, damma, kasra, shadda, sukun, and the small high/low
 *                 combining marks (madda above, small high seen, small high
 *                 rounded zero, etc.) used in Uthmani orthography
 *  U+0670         Arabic Letter Superscript Alif (the small "dagger alif")
 *                 -- a combining mark that represents a long vowel graphically
 *                 but is a diacritic-class codepoint (general category Mn),
 *                 safe to strip for matching purposes
 *  U+06D6–U+06DC  Quranic annotation signs (small high ligatures: sala,
 *                 qala, etc. -- recitation-pause / editorial marks)
 *  U+06DF–U+06E4  Quranic annotation signs (small high rounded zero,
 *                 small high upright rectangular zero, small high meem
 *                 isolated form, small high madda, small high yeh, etc.)
 *  U+06E7–U+06E8  Small high yeh, small high noon
 *  U+06EA–U+06ED  Quranic sign for sajda/empty rectangle-like combining marks,
 *                 small low seen, small high madda (variant), small low meem
 *  U+08D3–U+08E1  Arabic Extended-A: additional Quranic annotation marks
 *                 (small low waw, extended Quranic marks used in some
 *                  Uthmani datasets)
 *  U+08E3–U+08FF  Arabic Extended-A: further combining Quranic annotation
 *                 marks (turned damma, curly fatha/damma/kasra used by
 *                 some Uthmani sources, etc.)
 *
 * Also removed (non-diacritic but noise for exact-match search):
 *  U+06DD         Arabic End of Ayah (۝) -- the verse-end marker glyph itself
 *  U+0660–U+0669  Arabic-Indic digits (the ayah number that sometimes
 *                 follows the end-of-ayah mark inline in some text sources)
 *  U+200C, U+200D, U+200E, U+200F, U+FEFF
 *                 Zero-width non-joiner/joiner, LTR/RTL marks, BOM --
 *                 invisible formatting characters that break exact string
 *                 matching but carry no phonetic meaning
 *
 * DO NOT strip -- these are LETTERS, not diacritics, and removing them
 * changes the word:
 *  U+0621  ء  HAMZA (standalone letter, e.g. in سَمَاءً)
 *  U+0624  ؤ  WAW WITH HAMZA ABOVE (a distinct letter, not waw + diacritic)
 *  U+0626  ئ  YEH WITH HAMZA ABOVE (distinct letter)
 *  U+0622  آ  ALEF WITH MADDA ABOVE (a distinct letter -- NOT "alef + madda
 *              diacritic"; stripping the madda from U+0622 would corrupt
 *              the letter itself since it is a single precomposed codepoint,
 *              not a base+combining-mark sequence)
 *  U+0623  أ  ALEF WITH HAMZA ABOVE (distinct letter)
 *  U+0625  إ  ALEF WITH HAMZA BELOW (distinct letter)
 *  U+0629  ة  TEH MARBUTA (distinct letter, not "teh + mark")
 *  U+0649  ى  ALEF MAKSURA (distinct letter, not "yeh without dots" diacritic)
 *
 * These seven are all in the "base letter" category (Lo), not the combining
 * mark category (Mn), so a category-based strip (see regex below) will not
 * touch them by construction -- but they are called out explicitly because
 * naive "remove anything that looks like a squiggle" approaches (e.g. manually
 * enumerated blacklists copy-pasted from the wrong source) frequently strip
 * U+0622 (which visually contains a madda) or over-normalize hamza forms
 * down to bare alef, which is a linguistic error, not a diacritic-removal.
 *
 * @param {string} verse - Uthmani verse text (display copy, left untouched)
 * @returns {string} normalized text for the search index only
 */
function stripDiacritics(verse) {
  if (typeof verse !== 'string') return '';

  return verse
    // Quranic annotation / honorific signs
    .replace(/[ؐ-ؚ]/g, '')
    // Core harakat + combining Quranic marks (fatha..sukun, small high/low marks)
    .replace(/[ً-ٟ]/g, '')
    // Superscript alif (dagger alif)
    .replace(/[ٰ]/g, '')
    // Quranic annotation signs (sala/qala ligatures, small high zero/meem/madda/yeh, etc.)
    .replace(/[ۖ-ۜ]/g, '')
    .replace(/[۟-ۤ]/g, '')
    .replace(/[ۧ-ۨ]/g, '')
    .replace(/[۪-ۭ]/g, '')
    // Arabic Extended-A: extra Quranic combining marks used by some Uthmani datasets
    .replace(/[࣓-࣡]/g, '')
    .replace(/[ࣣ-ࣿ]/g, '')
    // End-of-ayah marker and inline Arabic-Indic ayah numerals
    .replace(/[۝]/g, '')
    .replace(/[٠-٩]/g, '')
    // Invisible formatting characters
    .replace(/[‌‍‎‏﻿]/g, '')
    // Collapse whitespace left behind by removed inline numerals/marks
    .replace(/\s+/g, ' ')
    .trim();
}
