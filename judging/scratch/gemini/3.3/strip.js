/**
 * Strips tashkeel (diacritics) and Quranic annotational marks from a verse string
 * for search indexing purposes.
 * 
 * @param {string} verse - The raw Arabic Uthmani text of a verse.
 * @returns {string} The normalized Arabic text suitable for search indexing.
 */
function stripDiacritics(verse) {
  if (!verse) return '';

  // 1. Normalize to Unicode Canonical Composition (NFC)
  // NFC ensures that base letters with built-in diacritics remain composed as 
  // single code points (e.g., U+0622), preventing them from being split and stripped.
  const normalized = verse.normalize('NFC');

  // 2. Define regex for characters to strip:
  // - U+064B to U+0652: Standard Arabic Tashkeel (Fathatan, Dammatan, Kasratan, Fatha, Damma, Kasra, Shadda, Sukun)
  // - U+0653 to U+065F: Arabic Combining Diacritics (combining maddah, combining hamzas, wavy hamza below)
  // - U+0670: Superscript Alif (Dagger Alif)
  // - U+06D6 to U+06ED: Quranic Annotational/Pause Marks (Waqf signs, end of ayah, rub el hizb, etc.)
  const diacriticsRegex = /[\u064B-\u0652\u0653-\u065F\u0670\u06D6-\u06ED]/g;

  // 3. Remove the diacritics and return the clean text
  return normalized.replace(diacriticsRegex, '');
}
