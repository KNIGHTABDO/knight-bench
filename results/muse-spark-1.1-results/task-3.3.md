# Quran Web Rendering - Technical Design Doc

## 1. Imlaei vs Uthmani Script and Font Strategy

### Difference

**Imlaei (Simple / Imla'i):** Modern orthography. Uses standard 28 Arabic letters + regular hamza forms (أ إ آ ؤ ئ). Minimal diacritics in source. Example: `السماء`. Compliant with standard Arabic Unicode, renders with any Arabic font (System, Noto Naskh, Amiri).

**Uthmani (Uthmanic / Rasmu al-Mushaf):** Preserves orthography of Madinah Mushaf (King Fahd Complex). Differences:
- Uses archaic spelling: `ٱ` U+0671 Alef Wasla, dagger alif `ٰ` U+0670, `ۦ ْ۪` small letters.
- Contains Quranic-specific combining marks: small high seen/sad/mim, madd al-wajib, etc.
- Uses full set of Waqf marks: `ۖ ۗ ۘ ۙ ۚ ۛ ۜ ۝ ۞` U+06D6-U+06ED
- Uses additional extended Arabic block: U+08D3-08E2, U+08F0-08FF (small low meem, etc.)

A Tanzil `uthmani` text string has ~2x more codepoints than `simple`.

### Why naive rendering fails

A general-purpose Arabic font (e.g., `Segoe UI`, `Roboto Arabic`, `Noto Naskh Arabic` regular) lacks:
1. Glyphs for U+06D6-06ED, U+08xx Quranic marks -> shows tofu `□` or blank.
2. OpenType `GSUB`/`GPOS` for Quranic ligatures & small letters positioning - marks float or stack incorrectly.
3. Dagger alif (U+0670) placed with wrong metrics, collides.
4. Contextual forms for Uthmani-specific combinations like `لـء` with small high hamza.
5. No support for optional kashida justification features required for mushaf layout.

Result: missing glyphs, misplaced diacritics, broken shaping.

### Correct fonts

Designed for Quran:
- **KFGQPC Uthman Taha Naskh** / **KFGQPC Uthmanic Script HAFS** (official Madinah font) - gold standard, licensed free for non-commercial.
- **Amiri Quran** / **Amiri Quran Colored**
- **Scheherazade New** (SIL) - good coverage of U+06xx, U+08xx
- **Lateef, Noto Naskh Arabic** - partial coverage, not true mushaf.

For web: serve WOFF2 with `font-display: swap; font-feature-settings: "liga" 1, "calt" 1;`

### Page-specific font strategy (used by Quran.com, Tanzil)

Standard approach for Mushaf view (page synchronized to 604-page Madinah Mushaf):

Problem: Single KFGQPC font is ~500KB+ and line breaks will not match printed mushaf if you justify freely.

Solution:
1. Generate 604 subset fonts: `p001.woff2 ... p604.woff2`. Each contains only glyphs + positioning data for that page, with built-in advances so each line ends exactly where printed mushaf ends.
2. Store line data: API returns `page: 2, lines: [ {line_number:1, text:"ٱلْحَمْدُ لِلَّهِ..."} ]` where `text` already has correct spaces/tatweel to justify.
3. CSS:

```css
@font-face {
  font-family: 'QPC-p1';
  src: url('/fonts/qpc/p001.woff2') format('woff2');
  font-display: swap;
}
.quran-line {
  font-family: 'QPC-p1', 'KFGQPC Uthman Taha Naskh', serif;
  font-size: 34px;
  line-height: 1.9;
  text-align: center;
  direction: rtl;
}
```

React:

```jsx
function MushafPage({ pageNum, lines }) {
  return (
    <div dir="rtl" className={`mushaf qpc-p${pageNum}`}>
      {lines.map(l => <div key={l.line_number} className="quran-line">{l.text}</div>)}
    </div>
  )
}
```

For non-page view (search, translation, reading): use single `KFGQPC Uthman Taha Naskh` with normal flow.

---

## 2. `stripDiacritics` for SEARCH INDEXING ONLY

**IMPORTANT:** This function is NEVER applied to displayed text. Only to create normalized column/FTS index. Display always uses original Uthmani.

### Code points TO strip

Tashkeel / Harakat (U+064B-U+065F subset):
- U+064B ARABIC FATHATAN ً
- U+064C DAMMATAN ٌ
- U+064D KASRATAN ٍ
- U+064E FATHA َ
- U+064F DAMMA ُ
- U+0650 KASRA ِ
- U+0651 SHADDA ّ
- U+0652 SUKUN ْ
- U+0656 SUBSCRIPT ALEF ٖ
- U+0657 INVERTED DAMMA ٗ
- U+0658 MARK NOON GHUNNA ٘
- U+0670 SUPERSCRIPT ALEF ٰ - **special case**: for search often map to ا, but if pure strip, remove (see below exception logic)
- U+065D-065F (rare, Quranic)

Quranic annotation / Waqf / Small high letters:
- U+06D6-U+06DC ۖ-ۜ
- U+06DD END OF AYAH ۝ (keep separately if needed)
- U+06DE ۞
- U+06DF SMALL HIGH ROUNDED ZERO ۟
- U+06E0 SMALL HIGH UPRIGHT RECTANGULAR ZERO ۠
- U+06E1 SMALL HIGH DOTLESS HEAD OF KHAH ۡ
- U+06E2 SMALL HIGH MEEM INITIAL FORM ۢ
- U+06E3 SMALL LOW SEEN ۣ
- U+06E4 SMALL HIGH MADDA ۤ
- U+06E5-06E6 SMALL WAW, SMALL YEH ۥ ۦ
- U+06E7-06E8 ۧ ۨ
- U+06EA-06ED ۪-ۭ
- U+08D3-08E1, U+08E2, U+08E3, U+08F0-08F3, U+08F4-08FF (Quranic marks, small low/high letters)
- U+0640 TATWEEL ـ (formatting, must remove for search)

### Code points MUST NOT strip (letter-changing)

1. **U+0621-U+0626, U+0622, U+0623, U+0624, U+0625, U+0626** - base hamza letters: ء آ أ ؤ إ ئ . If you strip U+0654 HAMZA ABOVE and U+0655 HAMZA BELOW indiscriminately, you convert ؤ -> و, ئ -> ى, أ -> ا incorrectly. Must NOT strip these combining hamzas when they are part of letter identity. Safer: never strip U+0654, U+0655, U+0653 in simple range filter; handle via normalization mapping.
   - Example: MUST NOT map `مُؤْمِن` to `مومن` vs `مؤمن` incorrectly; but for search you want `أ` -> `ا` mapping in separate normalization step, not blind stripping.

2. **U+0653 MADDA ABOVE ٓ** and **U+0670 DAGGER ALEF ٰ** : U+0653 turns ا into آ conceptually; U+0670 is pronounced as alif in Uthmani (e.g., `هَٰذَا` = هذا). Stripping U+0670 deletes an entire letter sound. For search, map to ا not delete, or keep. If you blindly include U+0670 in stripped range, `هٰذا` becomes `هذ` (meaningless).

Other must-not-strip: U+0671 ALEF WASLA ٱ -> maps to ا, not deleted.

### Implementation

```js
const DIACRITICS_TO_STRIP = /[\u064B-\u064D\u064E-\u0650\u0651\u0652\u0656-\u0658\u065A\u065C\u065D\u0640\u06D6-\u06DC\u06DE-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u08D3-\u08E1\u08E3\u08F0-\u08ff]/g;

// For FTS we also remove ayah marker but separately
const QURAN_MARKERS = /[\u06DD\u06DE\u08D4-\u08E2]/g;

const ALEF_NORMALIZATION_MAP = {
  '\u0622': '\u0627', // آ -> ا
  '\u0623': '\u0627', // أ -> ا
  '\u0625': '\u0627', // إ -> ا
  '\u0671': '\u0627', // ٱ -> ا
};
const EXTRA_MAP = {
  '\u0624': '\u0648', // ؤ -> و
  '\u0626': '\u064A', // ئ -> ي
  '\u0649': '\u064A', // ى -> ي (for search)
  '\u0629': '\u0647', // optional: ة -> ه, decide per requirements - commented out if you need exact
};

function normalizeAlefForSearch(s) {
  return s.replace(/[\u0622\u0623\u0625\u0671]/g, c => ALEF_NORMALIZATION_MAP[c])
          .replace(/\u0670/g, '\u0627') // dagger alif -> alif for search, NOT stripped
          .replace(/[\u0624\u0626]/g, c => EXTRA_MAP[c]);
}

function stripDiacritics(verse) {
  if (!verse) return '';
  let t = verse.normalize('NFKD');
  t = t.replace(QURAN_MARKERS, '');
  t = t.replace(DIACRITICS_TO_STRIP, '');
  // Important: U+0654 HAMZA ABOVE, U+0655 HAMZA BELOW, U+0653 MADDA are NOT in DIACRITICS_TO_STRIP above.
  // They are preserved here, then handled by normalizeAlefForSearch to avoid letter loss.
  // Also U+0640 is already stripped (tatweel is not letter)
  return t;
}

export function normalizeForSearch(verse) {
  let s = stripDiacritics(verse);
  s = normalizeAlefForSearch(s);
  // collapse whitespace, remove tatweel already done
  return s.replace(/\s+/g, ' ').trim();
}
```

Test:
- Input: `بِسْمِ ٱللَّهِ هَٰذَا مُؤْمِنٌ۝`
- `stripDiacritics` -> not losing ؤ, preserve dagger as per map later
- display input unchanged.

---

## 3. Verse Wrapping and Mushaf Justification

### (a) Verse-end marker never wraps alone

Ayah end is two codepoints: `۝` U+06DD + number (Arabic-Indic digits ٠-٩ or plain). If break occurs between last word and marker, you get widowed `۝١٥` on next line - forbidden.

Strategy:

1. Wrap last word + end marker in `white-space: nowrap` container. Best: group with NBSP U+00A0 or WJ U+2060 WORD JOINER.

React component:

```jsx
function Verse({ text, number }) {
  const words = text.trim().split(' ');
  const last = words.pop();
  return (
    <span className="verse">
      {words.join(' ')}{' '}
      <span className="ayah-bound">
        {last}&nbsp;{/* NBSP prevents break */}
        <span className="ayah-marker">۝{toArabicDigits(number)}</span>
      </span>
    </span>
  );
}
// CSS
// .ayah-bound { white-space: nowrap; }
// .ayah-marker { display: inline-block; white-space: nowrap; }
```

Alternative robust: insert `U+2060 WORD JOINER` between last word and marker, and `U+00A0` before marker number. Use `text-wrap: nowrap` is CSS Level 4 but use fallback `white-space: nowrap`.

For multiple ayahs inline: use `display: inline` spans, ensure each ayah cluster itself is `inline-block`? No, better keep inline but NBSP method.

Also apply `word-break: keep-all; overflow-wrap: normal;` on verse container to avoid arbitrary break inside Arabic word. Set `line-break: strict`.

### (b) Mushaf-like justification (kashida vs inter-word)

Real mushaf: justification via **kashida** elongation (tatweel) + ligature stretching (`jalt`, `cswh` OpenType), not by inserting extra space between words.

CSS reality in 2024-2026:

- `text-align: justify` + `text-justify: inter-word` -> only widens spaces between words. Looks loose, not mushaf. Supported: all browsers.
- `text-justify: inter-character` -> distributes space between letters, slightly better but still space, not kashida.
- `text-justify: distribute` / `kashida` / `auto` - proposed in CSS Text Module Level 3/4. Spec mentions `kashida` value for Arabic. **Not supported** in Chrome (as of 2025-2026), not in Firefox stable. Old IE had `-ms-text-kashida-space` but deprecated. Safari has `-webkit-text-justify: distribute` but bugs and does not actually insert U+0640.

`font-feature-settings: "jalt" 1` enables justification alternates in fonts like Amiri Quran / KFGQPC, but browser only uses it if engine decides to justify; Chrome enables it for `text-align: justify` with Arabic, but stretching amount is minimal, not equal to mushaf.

**Honest fallback / industry standard:**

1. For true mushaf page view: DO NOT use CSS justification. Use pre-computed lines with built-in spacing from QPC data (as in section 1). Each line is already justified to fixed width via font subsetting. Render as `text-align: center` or `justify` disabled (`text-align: justify; text-align-last: justify;` actually not needed). This is what Quran.com / Waqf apps do. This is the only way to match printed mushaf 100%.

2. For reflowable reading (translation view, list view): Accept inter-word justification as fallback:

```css
.quran-reflow {
  direction: rtl;
  text-align: justify;
  text-justify: inter-word;
  font-feature-settings: "jalt" 1, "calt" 1, "liga" 1;
  font-variant-ligatures: contextual;
}
```

Optional JS enhancement: measure line remaining space, insert `ـ` U+0640 at allowed cursive joining points (after ل, etc.) via binary search. Very expensive, causes reflow jank, breaks copy-paste, and should be avoided unless you build mature typesetting engine. Most teams explicitly decide **not** to implement auto-kashida and document that limitation.

Document in UI: "Reflow view uses standard web justification; for authentic mushaf layout switch to Page view."

---

## 4. SQLite Schema with FTS5 - Search normalized, display Uthmani

Goal: exact-match on normalized (diacritic-free) but display original.

### Pipeline

1. Ingest: `uthmani_text` from Tanzil (with all diacritics).
2. Preprocess: `normalized = normalizeForSearch(uthmani_text)` (JS function above).
3. Store both.
4. FTS5 indexes `normalized` only. Use `unicode61` tokenizer, but disable its own diacritic removal (`remove_diacritics 0`) because we do Quran-specific stripping.
5. Use content-sync triggers.

### Schema

```sql
CREATE TABLE verses (
  id INTEGER PRIMARY KEY, -- e.g., (sura*1000)+ayah or global sequential
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  page INTEGER NOT NULL,
  juz INTEGER NOT NULL,
  uthmani_text TEXT NOT NULL, -- full with tashkeel, for display
  imlaei_text TEXT, -- optional for accessibility
  normalized_text TEXT NOT NULL, -- stripped, alef-normalized, for debugging / exact match
  UNIQUE(surah, ayah)
);
CREATE INDEX idx_verses_page ON verses(page);
CREATE INDEX idx_verses_surah_ayah ON verses(surah, ayah);

-- FTS5 virtual table, external content
CREATE VIRTUAL TABLE verses_fts USING fts5(
  normalized_text,
  content='verses',
  content_rowid='id',
  tokenize="unicode61 'remove_diacritics 0 tokenchars \u0670\u0671'",
  prefix='2 3'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
  INSERT INTO verses_fts(rowid, normalized_text) VALUES (new.id, new.normalized_text);
END;
CREATE TRIGGER verses_ad AFTER DELETE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, normalized_text) VALUES('delete', old.id, old.normalized_text);
END;
CREATE TRIGGER verses_au AFTER UPDATE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, normalized_text) VALUES('delete', old.id, old.normalized_text);
  INSERT INTO verses_fts(rowid, normalized_text) VALUES (new.id, new.normalized_text);
END;

-- Optional: mushaf lines for page view
CREATE TABLE mushaf_lines (
  page INTEGER NOT NULL,
  line_number INTEGER NOT NULL,
  verse_id INTEGER NOT NULL REFERENCES verses(id),
  line_text TEXT NOT NULL, -- pre-justified line from QPC
  PRIMARY KEY(page, line_number)
);
```

### Ingest JS (Node / React build script)

```js
import Database from 'better-sqlite3';
import { normalizeForSearch } from './quranNormalize.js'; // function from section 2
import tanzilUthmani from './tanzil.json';

const db = new Database('quran.db');
db.exec(schemaSQL);

const insert = db.prepare(`INSERT INTO verses (id, surah, ayah, page, juz, uthmani_text, normalized_text) VALUES (?,?,?,?,?,?,?)`);

for (const v of tanzilUthmani) {
  const norm = normalizeForSearch(v.text);
  insert.run(v.id, v.surah, v.ayah, v.page, v.juz, v.text, norm);
}
```

### Query

```js
function searchQuran(db, userQuery) {
  const normQ = normalizeForSearch(userQuery);
  // exact-match on normalized, but return Uthmani for display
  // Use FTS MATCH with quoting for exact phrase
  const rows = db.prepare(`
    SELECT v.surah, v.ayah, v.uthmani_text, rank
    FROM verses_fts f
    JOIN verses v ON v.id = f.rowid
    WHERE verses_fts MATCH ?
    ORDER BY rank
  `).all(`"${normQ}"`); // exact phrase on normalized

  return rows; // display v.uthmani_text
}
```

If you need "exact-match search on normalized text but display of full Uthmani" with token-level exactness (no stemming), the above is sufficient. For LIKE exact match after FTS prefilter, add `AND v.normalized_text = ?`.

Key principle: Never overwrite `uthmani_text`; all normalization is one-way derived column for indexing only.
