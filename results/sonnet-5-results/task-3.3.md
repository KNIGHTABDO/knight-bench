# Quran Reading Feature — Technical Design Notes (Script Rendering, Search Normalization, Line-Breaking, Storage)

## 1. Imlaei vs Uthmani script, font problems, and the standard rendering approach

**Imlaei ("simplified"/spelling)** text is Quranic Arabic written with modern standard Arabic orthography rules — the same conventions used in newspapers, textbooks, and general-purpose Arabic fonts. It uses the modern spelling of long vowels, modern placement of hamza, and standard diacritic usage. This is the text most non-specialist Arabic fonts (Noto Naskh Arabic, Amiri, Dubai, Cairo, system Arabic fonts, etc.) were built to render correctly, because it uses the same character sequences as ordinary Arabic prose.

**Uthmani script** (rasm 'Uthmani) is a specific, archaic orthography that preserves the spelling conventions attributed to the Uthmanic codices of the Quran — spellings that often differ from modern Imlaei spelling (e.g. extra/omitted alifs, different hamza carriers, words written contracted or expanded differently than modern rules would dictate) plus a large, specialized layer of recitation-guidance marks (tajweed-adjacent annotation): small high marks for silent/optional letters, sukun variants, small waw/ya/alif superscript letters, imala/ishmam marks, verse-end (ayah) markers, rubʼ/hizb markers, sajda marks, etc. These are not "extra styling" — they are meaningful characters that change how the text should be read or that mark a silent letter versus a pronounced one.

**Why a general-purpose Arabic font breaks on Uthmani text:**

- Uthmani text uses codepoints from the Arabic Extended-A block and the Quranic-specific ranges (U+08xx, and the Arabic Presentation area used for Quranic annotation) that most fonts' `cmap` tables simply do not include. A missing glyph renders as `.notdef` (a box/tofu) or is silently dropped by the shaper.
- Even for codepoints a general font *does* have, it usually lacks the specific OpenType `GSUB`/`GPOS` rules to correctly position small superscript letters (small high seen, small high noon, small waw, small yeh, small alif), stacked multi-diacritic clusters, and the specific mark-to-base/mark-to-mark anchoring Uthmani orthography requires. Generic fonts are tuned for a much shallower diacritic stack (at most one harakah + maybe shadda) than Uthmani script routinely produces (harakah + maddah + small high mark + sukun-like symbol stacked on one letter).
- The result is glyphs that render in the wrong position (floating diacritics, overlapping marks), the wrong glyph substituted, or nothing at all — which is worse than aesthetically wrong, because a misplaced sukun/shadda changes the reading instruction conveyed by the text.

**Fonts designed for this**, in rough order of how the ecosystem uses them:

- **KFGQPC Uthmanic Script HAFS** (and the newer **KFGQPC HAFS Uthmanic Script v2 / v3**) — produced by the King Fahd Complex for the Printing of the Holy Quran (Madinah Mushaf). This is the reference font behind the Madinah Mushaf text and is what most "read the standard Uthmani Mushaf" apps use for continuous (non-page-image) rendering.
- **Amiri Quran** (a Quran-specific extension of the Amiri typeface, by Khaled Hosny) — a strong open-source (OFL) option with genuinely complete Uthmani OpenType support, actively maintained, good fallback choice if you can't/won't ship the KFGQPC fonts.
- **Al Qalam Quran Majeed / IndoPak Naskh / KFGQPC IndoPak** — used for the IndoPak script tradition (common in South Asia), a visually distinct tradition from the Madinah Mushaf glyph shapes; treat as a separate script variant, not interchangeable with Uthmani-Madinah fonts.
- **QCF (Quran Complex Font) family**, also called **"page fonts"** or **"Surah fonts"** — see below.

**The page-specific font strategy** used by major Quran apps (quran.com/QuranWBW's public rendering approach, Quran Android/iOS apps built on the King Fahd Complex data, Tanzil-derived apps, etc.): the Madinah Mushaf has a fixed, canonical 15-line-per-page layout (604 pages in the standard Hafs/Uthmani print). To reproduce that *exact* page layout pixel-for-pixel (so a user can reference "page 2, line 3" the same way in the app as in the printed Mushaf), apps don't rely on a single font + line-wrapping algorithm at all. Instead:

- Each **page of the Mushaf has its own font file** (QCF page fonts, e.g. `QCF_P001.woff`, `QCF_P002.woff`, ... one per page, occasionally one per line-set) where the glyphs for that page are pre-composed and pre-positioned specifically so that rendering the page's text in that font, at a specified size, reproduces the original mushaf's exact line breaks and word spacing.
- The app stores, per word or per line, a mapping from `(surah, ayah, word_position)` → `(page_number, line_number, glyph_code)` and simply renders the codepoints for that page using that page's font. No client-side line-breaking or justification logic is needed for "mushaf mode" — the font *is* the layout.
- This sidesteps every hard problem in section 3 (kashida justification, verse-marker orphaning) for the "look exactly like the printed Mushaf" reading mode, at the cost of: large asset payload (600+ font files, though usually subsetted/lazy-loaded per page), inability to reflow for arbitrary screen widths/font sizes, and reliance on a specific data source (King Fahd Complex / Tanzil / QuranEnc-style page datasets) that ships that page-to-glyph mapping.
- For a **responsive, non-paginated reading mode** (verse-by-verse, adjustable font size, translations inline), apps fall back to a single continuous Uthmani font (KFGQPC Uthmanic Script or Amiri Quran) and accept that line breaks will not match the printed Mushaf — this is the "translation view" / "reading view" most apps default to, with page-image or page-font mode offered as a separate "Mushaf view."

**Recommendation for this feature:** ship Amiri Quran (or KFGQPC Uthmanic Script if licensing terms are acceptable — it's freely distributable but check the King Fahd Complex license text bundled with it) as the single continuous font for a reflowable reading view. If a "Mushaf page view" is in scope, treat it as a separate rendering path using QCF page fonts + a page/line/word mapping table, not as an extension of the reflow renderer.

---

## 2. `stripDiacritics(verse)` for search indexing

The function below is intended to build a **secondary, normalized search field only**. The verse stored/rendered for display must remain the original Uthmani text untouched.

```javascript
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
```

A safer, more future-proof alternative to the manual range list above is to combine Unicode normalization with a general-category filter, so any diacritic codepoint the range list missed (new Unicode Quranic marks do get added over time) is still caught:

```javascript
function stripDiacriticsByCategory(verse) {
  if (typeof verse !== 'string') return '';
  return verse
    .normalize('NFD')                       // decompose where decomposition exists
    .replace(/\p{Mn}/gu, '')                 // strip all "Mark, Nonspacing" codepoints
    .replace(/[۝٠-٩]/g, '')   // end-of-ayah + inline digits (not category Mn)
    .replace(/[‌‍‎‏﻿]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Important caveat on the `\p{Mn}` approach: it is *not* a strict superset improvement — it correctly avoids stripping U+0622/U+0624/U+0626 etc. (they are category Lo, letters, so `\p{Mn}` never touches them, confirming the "do not strip" list above), but you should still test it against a full mushaf dataset (e.g. Tanzil Uthmani text) diffed against the manual-range output before trusting it in production, since some Quranic annotation codepoints in the Arabic Extended-A block are categorized inconsistently across Unicode versions.

---

## 3. Line-breaking and justification strategy for verse text

### (a) Preventing the verse-end marker from wrapping alone

The end-of-ayah mark (۝, U+06DD) is typically followed by the ayah number rendered as part of the same glyph cluster/ligature (either via the page font's precomposed glyph, or as `۝` + Arabic-Indic digits + possibly an enclosing ornament). If ordinary line-wrapping (soft-wrap at whitespace) is allowed to break between the last word of the ayah and this marker, or between the marker and its number, you get a single glyph orphaned at the start of the next line — visually wrong and semantically confusing (it can read as belonging to the next verse).

The fix is to make the marker (and its number) behave as a single unbreakable unit, and to prevent a break immediately before it:

```javascript
// Given raw verse text ending in "... كَلِمَةٌ ۝٣"
// Insert a non-breaking space before the marker, and wrap the marker+number
// in a span with white-space: nowrap and word-break: keep-all so the shaping
// engine and the line-breaker never split inside it.
function wrapVerseMarker(verseHtml, ayahNumber) {
  const marker = `۝${toArabicIndicDigits(ayahNumber)}`;
  return `${verseHtml} <span class="ayah-marker" dir="rtl">${marker}</span>`;
}
```

```css
.ayah-marker {
  white-space: nowrap;   /* never break inside marker+number */
  word-break: keep-all;
  unicode-bidi: isolate;
  display: inline-block;
}
/* the preceding   (non-breaking space) is the real load-bearing part:
   CSS cannot forbid a break BEFORE an inline element on its own, so the
   glue between the last word and the marker must itself be non-breaking. */
```

The `white-space: nowrap` on the span only stops breaks *inside* the marker cluster; it does nothing to stop a break landing *between* the previous word and the span (that boundary is still a normal space by default, which is a valid break opportunity). The non-breaking space (` `) — not CSS — is what glues the marker to its preceding word so the pair is forced onto the same line or wraps together to the next line.

For extra safety at very narrow widths, wrap "last word + NBSP + marker" together rather than just gluing to the marker, since a single overlong final "word+marker" unit can still overflow the container — that overflow is an accepted tradeoff (better than an orphaned symbol).

### (b) Mushaf-style justification: kashida (tatweel) vs. word-spacing

Printed Mushaf justification does not primarily stretch inter-word spaces (that's what Latin-style `text-align: justify` does); it stretches letters *within* words using kashida/tatweel (ـ, U+0640) elongation of certain letter-to-letter connections, chosen by calligraphic rules about which letter pairs may be elongated and by how much, combined with more conservative inter-word spacing than Latin justification.

**What CSS can do today:**
- `text-align: justify` + `text-justify: inter-word` (or the browser default) will justify by stretching spaces between words. Widely supported, but produces the "wrong" look for a mushaf — big ugly gaps, not the calligraphic stretched-letter look.
- `text-justify: kashida` (with `text-align: justify`) requests kashida-based justification instead of/in addition to word-spacing. This is **not implemented in any major browser engine today** (not Chromium/Blink, not Firefox/Gecko, not WebKit) despite being in the CSS Text Module Level 3/4 spec as a keyword. Support is effectively zero — do not rely on it, and feature-detect rather than assume it silently falls back to something sane.
- Manually inserting literal U+0640 tatweel characters into the text string to fake elongation is unreliable and actively wrong for correctness: it requires calligraphic-rule knowledge of *which* letter joints are legal to stretch (not all letters connect, and not all connecting letters should be stretched equally), it will get shaped differently per font (some fonts substitute a kashida ligature glyph, others just render a literal dash-like stroke), and — critically — it pollutes the stored/searchable text with a character that isn't semantically part of the verse.

**Honest fallback:** there is no CSS-only way to reproduce true calligraphic kashida justification in 2026 across browsers. The realistic options, in order of fidelity vs. cost:

1. **Don't justify at all** — left/right-align (ragged edge) the Uthmani text, which is what most reflowable Quran apps actually ship for non-page-image views. This is the honest, low-cost default: it avoids both the ugly-gap problem and the fake-kashida problem.
2. **Use the QCF page-font strategy from Section 1** for a dedicated "Mushaf view" — the justification (including kashida stretching) is already baked into the pre-rendered glyph positions of that page's font, so you get correct-looking justification "for free" by rendering exactly what the page font encodes, at the cost of losing reflow/resizing.
3. **Render pre-rasterized page images** (PNG/SVG of actual mushaf pages, as some apps do for "exact print replica" mode) — perfect fidelity, zero CSS text layout involved, but not selectable/copyable text and not accessible without a parallel text layer for screen readers/search.
4. **JS-driven pseudo-kashida** (measure each line, algorithmically insert a computed number of tatweel characters at font/script-aware legal insertion points to hit a target line width) is theoretically possible but is a significant typography engineering project on its own (essentially reimplementing part of an Arabic justification engine) and still font-dependent; only worth it if a page-font/page-image approach is off the table for product reasons.

Recommendation: ship ragged-edge (non-justified) text for the reflowable reading view, and if "looks like a real mushaf" is a hard requirement, invest in the page-font or page-image approach rather than chasing CSS kashida justification.

---

## 4. SQLite / FTS5 schema for normalized search + Uthmani display

Goal: exact-match (and prefix/token) search against normalized text, while always displaying the original Uthmani text untouched. Keep FTS5 as an external-content index over a canonical verses table so the Uthmani text is stored exactly once and the FTS index only stores the searchable derivative.

```sql
-- Canonical verse storage: the single source of truth for display text.
-- Uthmani text is stored verbatim, never mutated by the search pipeline.
CREATE TABLE verses (
  id             INTEGER PRIMARY KEY,
  surah          INTEGER NOT NULL,
  ayah           INTEGER NOT NULL,
  text_uthmani   TEXT NOT NULL,   -- full Uthmani script, for display/rendering
  text_imlaei    TEXT,            -- optional: Imlaei rendering, if sourced separately
  text_normalized TEXT NOT NULL,  -- output of the normalization pipeline; stored so
                                   -- it can be inspected/debugged and reused without
                                   -- recomputation, and so FTS5 external-content sync
                                   -- has a stable column to index
  page_number    INTEGER,         -- for "mushaf view" page/line mapping (Section 1)
  UNIQUE(surah, ayah)
);

-- External-content FTS5 index: does not duplicate the Uthmani text storage,
-- only indexes the normalized column. rowid is shared with verses.id so
-- FTS5 can join back to fetch the display text for a hit.
CREATE VIRTUAL TABLE verses_fts USING fts5(
  text_normalized,
  content='verses',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 0'
  -- remove_diacritics is set to 0 deliberately: diacritic stripping is done
  -- by OUR normalization pipeline (with Quranic-aware rules from Section 2),
  -- not by FTS5's built-in Latin-oriented diacritic remover, which does not
  -- know about Arabic combining marks / Quranic annotation codepoints.
);

-- Keep the FTS index in sync with the canonical table via triggers,
-- since external-content tables are not auto-maintained.
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
  INSERT INTO verses_fts(rowid, text_normalized) VALUES (new.id, new.text_normalized);
END;

CREATE TRIGGER verses_ad AFTER DELETE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, text_normalized)
  VALUES ('delete', old.id, old.text_normalized);
END;

CREATE TRIGGER verses_au AFTER UPDATE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, text_normalized)
  VALUES ('delete', old.id, old.text_normalized);
  INSERT INTO verses_fts(rowid, text_normalized) VALUES (new.id, new.text_normalized);
END;
```

**Normalization pipeline** (produces `text_normalized` from `text_uthmani` at ingest time, not at query time, so search is a pure index lookup):

```javascript
/**
 * Ingest-time normalization pipeline: Uthmani -> search-normalized text.
 * Run once per verse when loading the dataset; store the result in
 * verses.text_normalized. Never run this against text you intend to display.
 */
function normalizeForSearch(uthmaniText) {
  let t = uthmaniText;

  // 1. Strip tashkeel/harakat and Quranic annotation marks (Section 2),
  //    while explicitly preserving hamza-bearing and madda letters.
  t = stripDiacritics(t);

  // 2. Normalize alef variants to bare alef for forgiving exact-ish matching
  //    (a common, deliberate choice for Arabic search UX -- NOT applied to
  //    display text). This does change letters, but it is a documented,
  //    intentional search-relevance decision, distinct from the diacritic
  //    stripping in step 1.
  t = t
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ة/g, 'ه')                       // ة -> ه (teh marbuta -> heh), optional
    .replace(/ى/g, 'ي');                      // ى -> ي (alef maksura -> yeh), optional

  // 3. Normalize whitespace and strip tatweel/kashida if present in source data
  t = t.replace(/ـ/g, '').replace(/\s+/g, ' ').trim();

  // 4. Unicode-normalize to NFC for consistent codepoint sequences across
  //    data sources that may deliver decomposed vs. precomposed forms.
  t = t.normalize('NFC');

  return t;
}
```

Note on step 2: alef/teh-marbuta/alef-maksura folding is a *search relevance* normalization, separate from and layered on top of diacritic stripping — call this out explicitly in code comments and documentation, because unlike Section 2's list, this step does deliberately conflate distinct letters for the sake of forgiving search (a very common and expected behavior for Arabic search UX, since users frequently type without distinguishing these forms), and it must never be applied anywhere near the display path.

**Query example** — search normalizes the user's query the same way, then looks up display text via the join:

```sql
SELECT v.surah, v.ayah, v.text_uthmani, v.page_number
FROM verses_fts f
JOIN verses v ON v.id = f.rowid
WHERE verses_fts MATCH :normalized_query
ORDER BY rank;
```

```javascript
function searchVerses(db, userQuery) {
  const normalizedQuery = normalizeForSearch(userQuery);
  return db
    .prepare(`
      SELECT v.surah, v.ayah, v.text_uthmani, v.page_number
      FROM verses_fts f
      JOIN verses v ON v.id = f.rowid
      WHERE verses_fts MATCH ?
      ORDER BY rank
    `)
    .all(normalizedQuery);
}
```

This keeps a strict separation of concerns: `text_uthmani` is never touched by normalization and is the only column ever sent to the renderer; `text_normalized` is derived, disposable (could be dropped and regenerated from `text_uthmani` + the pipeline function at any time), and is the only column FTS5 ever tokenizes.
