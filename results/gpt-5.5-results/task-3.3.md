# Technical Design: Quran Text Rendering and Search in React

## Scope

This document covers a Quran reading feature for the web using React. The design separates:

- **Display text**, which should preserve full Uthmani Quranic orthography and all marks needed for correct visual rendering.
- **Search/index text**, which may be normalized aggressively for matching, but must never be used for display.

The central rule is: **do not treat Quran display text as ordinary Arabic prose**. Uthmani Quran text has specialized code points, annotation marks, shaping expectations, verse markers, and page-layout conventions.

---

## 1. Imlaei vs Uthmani Text Sources

### Imlaei script

**Imlaei** text is Quran text represented in modern standard Arabic spelling conventions. It is closer to what a general Arabic reader would type, search, or expect in ordinary Arabic text processing.

Typical properties:

- Uses common Arabic letters and common combining marks.
- Avoids many Quran-specific orthographic symbols.
- Easier to search, normalize, tokenize, and compare.
- Renders reasonably with general-purpose Arabic fonts such as Noto Naskh Arabic, Amiri, Scheherazade New, Arial, etc.
- Not visually identical to a printed mushaf.

Imlaei is generally appropriate for:

- Search indexes.
- Autocomplete.
- Text comparison.
- Transliteration alignment.
- Educational tools where ordinary spelling is desired.

It is generally not sufficient if the product promise is "display the Quran like the mushaf."

### Uthmani script

**Uthmani** text preserves the traditional Quranic orthography used in mushaf printing. It includes:

- Quran-specific combining marks.
- Pause marks.
- Small high letters.
- Superscript alef.
- Quranic annotation signs.
- Orthographic conventions that are not the same as modern Arabic spelling.

Uthmani is appropriate for:

- Verse display.
- Mushaf-style reading.
- Page-based Quran layouts.
- Tajweed-aware or mark-preserving interfaces.

It is not ideal as the only search representation because users usually search with simplified modern spelling, often without harakat.

### Why general-purpose Arabic fonts fail for Uthmani text

Arabic shaping is contextual, and Quranic Uthmani text goes further than ordinary Arabic. It depends on careful positioning and substitution of:

- Combining harakat.
- Stacked marks.
- Quranic annotation signs.
- Superscript letters.
- Pause signs.
- Alternate glyphs and ligature-like Quranic forms.

A general Arabic font may contain normal Arabic letters and common harakat but lack Quran-specific glyphs or OpenType positioning rules. The result can be:

- Missing glyph boxes.
- Marks drawn in the wrong place.
- Marks colliding with letters or with each other.
- Quranic annotation marks appearing as generic symbols instead of properly positioned signs.
- Broken or ugly shaping around special Quranic characters.
- Line metrics that do not match mushaf expectations.

The issue is not only "font coverage"; it is also **font engineering**. A font must include the relevant glyphs and the OpenType tables needed to position marks correctly in dense Quranic text.

### Fonts designed for Uthmani Quran text

Common Quran-oriented fonts include:

- **KFGQPC Uthman Taha Naskh**
- **KFGQPC HAFS Uthmanic Script**
- **KFGQPC Uthmanic Script HAFS**
- **KFGQPC Uthman Taha Naskh Regular**
- **QCF page fonts**, often named by page number, such as `QCF_P001`, `QCF_P002`, etc.
- **UthmanicHafs** or app-distributed derivatives based on King Fahd Glorious Quran Printing Complex assets, depending on license and source.
- **Scheherazade New** and **Amiri Quran** can render many Quranic marks better than generic fonts, but they are not equivalent to page-perfect mushaf fonts.

The exact font choice depends on the text source. A Uthmani text source should be paired with a font known to support that source's encoding and mark strategy.

### Standard approach in Quran apps

Major Quran apps usually do not render the whole Quran with one generic Arabic font and hope for mushaf-like output. The common production approach is:

1. Store verse-level canonical text separately from display layout.
2. For a normal verse-by-verse reading mode, render Uthmani text using a Quran-capable font.
3. For true mushaf page mode, use **page-specific Quran fonts** or page images.

The page-specific font strategy is important:

- Each mushaf page can have its own font file.
- The glyphs in that font are designed so the text of that exact page matches the printed mushaf layout.
- The app loads only the font for the current page or a small window of nearby pages.
- CSS maps the current page to its corresponding `font-family`, for example `QCF_P001` for page 1.

This is how many apps approximate the Madani mushaf digitally. The font is not merely a style; it is part of the layout system.

Example React font selection:

```tsx
type QuranTextMode = "verse" | "mushaf-page";

function qcfFontFamily(pageNumber: number): string {
  return `QCF_P${String(pageNumber).padStart(3, "0")}`;
}

function QuranVerseText({
  text,
  mode,
  pageNumber,
}: {
  text: string;
  mode: QuranTextMode;
  pageNumber?: number;
}) {
  const fontFamily =
    mode === "mushaf-page" && pageNumber
      ? qcfFontFamily(pageNumber)
      : "KFGQPC Uthman Taha Naskh, Amiri Quran, Scheherazade New, serif";

  return (
    <span className="quran-text" style={{ fontFamily }}>
      {text}
    </span>
  );
}
```

Example page-specific `@font-face` declarations:

```css
@font-face {
  font-family: "QCF_P001";
  src: url("/fonts/qcf/QCF_P001.woff2") format("woff2");
  font-display: swap;
}

@font-face {
  font-family: "QCF_P002";
  src: url("/fonts/qcf/QCF_P002.woff2") format("woff2");
  font-display: swap;
}

.quran-text {
  direction: rtl;
  unicode-bidi: isolate;
  font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "mark" 1, "mkmk" 1;
  line-height: 2.1;
}
```

For a full Quran, generate these declarations instead of hand-writing 604 entries.

---

## 2. Search-Only Diacritic Stripping

### Rule

`stripDiacritics(verse)` is for **search indexing only**. It must never be used to render Quran text to the user.

The display text must preserve:

- Uthmani spelling.
- Harakat.
- Quranic signs.
- Pause marks.
- Superscript letters.
- Verse marks.

Search text can strip non-letter marks to make matching easier.

### Unicode code points and ranges to strip

For a Quran search normalization pipeline, strip these marks:

- `U+0610..U+061A` Arabic sign range:
  - `U+0610` ARABIC SIGN SALLALLAHOU ALAYHE WASSALLAM
  - `U+0611` ARABIC SIGN ALAYHE ASSALLAM
  - `U+0612` ARABIC SIGN RAHMATULLAH ALAYHE
  - `U+0613` ARABIC SIGN RADI ALLAHOU ANHU
  - `U+0614` ARABIC SIGN TAKHALLUS
  - `U+0615` ARABIC SMALL HIGH TAH
  - `U+0616` ARABIC SMALL HIGH LIGATURE ALEF WITH LAM WITH YEH
  - `U+0617` ARABIC SMALL HIGH ZAIN
  - `U+0618` ARABIC SMALL FATHA
  - `U+0619` ARABIC SMALL DAMMA
  - `U+061A` ARABIC SMALL KASRA
- `U+064B..U+065F` Arabic combining marks:
  - `U+064B` FATHATAN
  - `U+064C` DAMMATAN
  - `U+064D` KASRATAN
  - `U+064E` FATHA
  - `U+064F` DAMMA
  - `U+0650` KASRA
  - `U+0651` SHADDA
  - `U+0652` SUKUN
  - `U+0653` MADDAH ABOVE
  - `U+0654` HAMZA ABOVE
  - `U+0655` HAMZA BELOW
  - `U+0656` SUBSCRIPT ALEF
  - `U+0657` INVERTED DAMMA
  - `U+0658` MARK NOON GHUNNA
  - `U+0659` ZWARAKAY
  - `U+065A` VOWEL SIGN SMALL V ABOVE
  - `U+065B` VOWEL SIGN INVERTED SMALL V ABOVE
  - `U+065C` VOWEL SIGN DOT BELOW
  - `U+065D` REVERSED DAMMA
  - `U+065E` FATHA WITH TWO DOTS
  - `U+065F` WAVY HAMZA BELOW
- `U+0670` ARABIC LETTER SUPERSCRIPT ALEF
- `U+06D6..U+06ED` Quranic annotation marks:
  - `U+06D6` SMALL HIGH LIGATURE SAD WITH LAM WITH ALEF MAKSURA
  - `U+06D7` SMALL HIGH LIGATURE QAF WITH LAM WITH ALEF MAKSURA
  - `U+06D8` SMALL HIGH MEEM INITIAL FORM
  - `U+06D9` SMALL HIGH LAM ALEF
  - `U+06DA` SMALL HIGH JEEM
  - `U+06DB` SMALL HIGH THREE DOTS
  - `U+06DC` SMALL HIGH SEEN
  - `U+06DD` END OF AYAH
  - `U+06DE` START OF RUB EL HIZB
  - `U+06DF` SMALL HIGH ROUNDED ZERO
  - `U+06E0` SMALL HIGH UPRIGHT RECTANGULAR ZERO
  - `U+06E1` SMALL HIGH DOTLESS HEAD OF KHAH
  - `U+06E2` SMALL HIGH MEEM ISOLATED FORM
  - `U+06E3` SMALL LOW SEEN
  - `U+06E4` SMALL HIGH MADDA
  - `U+06E5` SMALL WAW
  - `U+06E6` SMALL YEH
  - `U+06E7` SMALL HIGH YEH
  - `U+06E8` SMALL HIGH NOON
  - `U+06E9` PLACE OF SAJDAH
  - `U+06EA` EMPTY CENTRE LOW STOP
  - `U+06EB` EMPTY CENTRE HIGH STOP
  - `U+06EC` ROUNDED HIGH STOP WITH FILLED CENTRE
  - `U+06ED` SMALL LOW MEEM
- Optionally strip Tatweel:
  - `U+0640` ARABIC TATWEEL

Whether to strip `U+0640` depends on your source. It is not a diacritic, but it is a kashida extender and usually should not affect search.

### Code points not to strip

Do **not** strip these as "diacritics" because they are letters or letter-distinguishing characters in Arabic text processing:

- `U+0622` ARABIC LETTER ALEF WITH MADDA ABOVE: `آ`
- `U+0623` ARABIC LETTER ALEF WITH HAMZA ABOVE: `أ`
- `U+0624` ARABIC LETTER WAW WITH HAMZA ABOVE: `ؤ`
- `U+0625` ARABIC LETTER ALEF WITH HAMZA BELOW: `إ`
- `U+0626` ARABIC LETTER YEH WITH HAMZA ABOVE: `ئ`
- `U+0621` ARABIC LETTER HAMZA: `ء`

Important nuance:

- `U+0653` COMBINING MADDAH ABOVE is a mark and can be stripped for a diacritic-insensitive search index.
- `U+0622` ALEF WITH MADDA ABOVE is a precomposed Arabic letter and must not be blindly removed. You may optionally normalize it to bare alef for a broader search key, but that is a separate letter-normalization decision, not diacritic stripping.

### JavaScript implementation

Use Unicode-aware regular expressions. Keep this function narrow: it strips marks and tatweel, but does not perform broader letter folding.

```ts
const SEARCH_DIACRITICS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function stripDiacritics(verse: string): string {
  return verse.replace(SEARCH_DIACRITICS_RE, "");
}
```

Example:

```ts
const display = "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ";
const search = stripDiacritics(display);

console.log(search);
// "ٱلحمد لله رب ٱلعلمين"
```

For search, this function is usually one stage in a larger pipeline:

```ts
const DIACRITICS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFC")
    .replace(DIACRITICS_RE, "")
    .replace(/\u06CC/g, "\u064A") // FARSI YEH -> ARABIC YEH, if user input may contain Persian forms
    .replace(/\u0649/g, "\u064A") // ALEF MAKSURA -> YEH, optional search broadening
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // alef variants -> alef, optional search broadening
    .replace(/\u0671/g, "\u0627") // ALEF WASLA -> ALEF, optional search broadening
    .replace(/\u0629/g, "\u0647") // TEH MARBUTA -> HEH, optional and language-sensitive
    .replace(/\s+/g, " ")
    .trim();
}
```

The broader folding choices above should be product decisions. For example, folding `ة` to `ه` may improve recall for casual users but can create false positives.

Recommended separation:

```ts
export function normalizeQuranDisplayText(input: string): string {
  return input.normalize("NFC");
}

export function normalizeQuranSearchText(input: string): string {
  return normalizeForSearch(input);
}
```

---

## 3. Verse Rendering, Wrapping, and Justification

### Requirement A: verse-end marker must not wrap alone

A verse-end marker is usually:

- `U+06DD` ARABIC END OF AYAH: `۝`
- Followed by an ayah number, either plain digits or Arabic-Indic digits.

The marker must stay attached to the end of the verse text. It should never appear at the start of a line by itself.

#### React rendering strategy

Render the final word and ayah marker as a non-breaking inline group when possible.

Instead of rendering:

```tsx
{verseText} ۝{ayahNumber}
```

render a tokenized structure:

```tsx
function splitLastWord(text: string): { before: string; lastWord: string } {
  const trimmed = text.trimEnd();
  const match = trimmed.match(/^(.*?)(\S+)$/u);

  if (!match) {
    return { before: "", lastWord: trimmed };
  }

  return {
    before: match[1],
    lastWord: match[2],
  };
}

function toArabicIndicNumber(value: number): string {
  const digits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

export function VerseInline({
  text,
  ayahNumber,
}: {
  text: string;
  ayahNumber: number;
}) {
  const { before, lastWord } = splitLastWord(text);

  return (
    <span className="verse" dir="rtl">
      {before}
      <span className="verse-ending">
        {lastWord}
        <span className="ayah-marker" aria-label={`Ayah ${ayahNumber}`}>
          {"\u00A0\u06DD"}
          {toArabicIndicNumber(ayahNumber)}
        </span>
      </span>
    </span>
  );
}
```

CSS:

```css
.verse {
  direction: rtl;
  unicode-bidi: isolate;
}

.verse-ending {
  white-space: nowrap;
}

.ayah-marker {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
```

This keeps the final word and verse marker together. That is usually better than only attaching the marker to a non-breaking space, because if the final word stays on the previous line and only the marker moves, the marker still looks orphaned.

#### Alternative: Word Joiner

You can insert `U+2060 WORD JOINER` between the final word and the marker:

```ts
const WORD_JOINER = "\u2060";
const END_OF_AYAH = "\u06DD";

const rendered = `${verseText}${WORD_JOINER}${END_OF_AYAH}${toArabicIndicNumber(ayahNumber)}`;
```

However, explicit markup is easier to inspect, style, and test. Also, wrapping engines can behave differently across browsers when complex Arabic shaping, bidi isolation, and custom fonts are involved.

### Requirement B: mushaf-like justification

Mushaf justification is not ordinary web text justification.

In a printed mushaf, lines are justified through a combination of:

- Careful line breaking.
- Kashida elongation inside words.
- Calligraphic alternates.
- Page-specific glyph choices.
- Manual or font-assisted composition.
- In some digital systems, page-specific fonts where glyphs are engineered to fit a known line.

CSS can do some Arabic justification, but it cannot reliably reproduce mushaf composition today.

#### What CSS can do

CSS can request justified text:

```css
.quran-line {
  text-align: justify;
  text-align-last: justify;
}
```

Some engines support or partially support:

```css
.quran-line {
  text-justify: kashida;
}
```

But browser support is inconsistent. In many browsers, Arabic justification may fall back to spacing between words rather than proper kashida elongation. Even when kashida is attempted, the result is not page-perfect Quran typography.

CSS can also preserve whitespace and line breaks:

```css
.mushaf-page {
  white-space: pre-line;
}
```

This helps if your text source already contains authoritative line breaks.

#### What CSS cannot honestly do today

CSS cannot reliably:

- Choose Quranically appropriate kashida insertion points.
- Match a printed Madani mushaf page exactly.
- Reproduce page-specific calligraphic alternates.
- Guarantee consistent Arabic mark positioning across arbitrary fonts.
- Prevent all mark collisions in fonts not designed for Quranic text.
- Implement full mushaf justification with ordinary `text-align: justify`.

So the honest fallback is:

1. **For verse reading mode**:
   - Use a Quran-capable font.
   - Use natural wrapping.
   - Keep verse markers attached.
   - Avoid pretending this is page-perfect mushaf layout.

2. **For mushaf page mode**:
   - Use a source with official page and line breaks.
   - Use page-specific QCF fonts, or use high-resolution page images.
   - Load the exact font for the current page.
   - Render each mushaf line as a separate block with the exact text assigned to that line.

Example page-line rendering:

```tsx
type MushafLine = {
  page: number;
  line: number;
  text: string;
};

function MushafPage({ page, lines }: { page: number; lines: MushafLine[] }) {
  const fontFamily = qcfFontFamily(page);

  return (
    <main
      className="mushaf-page"
      dir="rtl"
      style={{ fontFamily }}
      aria-label={`Mushaf page ${page}`}
    >
      {lines.map((line) => (
        <div className="mushaf-line" key={`${line.page}:${line.line}`}>
          {line.text}
        </div>
      ))}
    </main>
  );
}
```

CSS:

```css
.mushaf-page {
  direction: rtl;
  unicode-bidi: isolate;
  width: min(100%, 44rem);
  margin-inline: auto;
  font-size: clamp(1.45rem, 2.8vw, 2.35rem);
  line-height: 1.85;
}

.mushaf-line {
  display: block;
  text-align: center;
  white-space: nowrap;
}
```

For a page-specific QCF font setup, `text-align: center` plus the page font and authoritative line breaks may produce a better result than generic CSS justification. The font and data source are doing the real layout work.

For responsive screens, do not reflow a mushaf page arbitrarily if the goal is page fidelity. Scale the page or line group as a unit, or switch to verse reading mode on small screens.

---

## 4. Storage and FTS5 Search Design

### Goals

The storage design should support:

- Exact display of full Uthmani text.
- Exact-match search on normalized text.
- FTS5 full-text search on normalized text.
- Stable verse identity by surah and ayah.
- Optional mushaf page and line rendering.

### Tables

Use separate columns for display and search. Never reconstruct display text from normalized search text.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE surahs (
  id INTEGER PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_transliterated TEXT,
  ayah_count INTEGER NOT NULL
);

CREATE TABLE verses (
  id INTEGER PRIMARY KEY,
  surah_id INTEGER NOT NULL,
  ayah_number INTEGER NOT NULL,

  -- Full canonical display text. Preserve Uthmani marks.
  text_uthmani TEXT NOT NULL,

  -- Optional modern spelling source, useful for search or comparison.
  text_imlaei TEXT,

  -- Normalized search keys. These are generated by the app pipeline.
  search_uthmani_norm TEXT NOT NULL,
  search_imlaei_norm TEXT,

  -- Optional metadata for page-based rendering.
  page_number INTEGER,
  juz_number INTEGER,
  hizb_number INTEGER,
  rub_number INTEGER,

  UNIQUE (surah_id, ayah_number),
  FOREIGN KEY (surah_id) REFERENCES surahs(id)
);

CREATE INDEX idx_verses_surah_ayah
  ON verses (surah_id, ayah_number);

CREATE INDEX idx_verses_page
  ON verses (page_number, surah_id, ayah_number);

CREATE INDEX idx_verses_search_uthmani_norm
  ON verses (search_uthmani_norm);

CREATE INDEX idx_verses_search_imlaei_norm
  ON verses (search_imlaei_norm);
```

For mushaf page mode, use a line table. This is better than trying to infer page lines from verse text at runtime.

```sql
CREATE TABLE mushaf_lines (
  id INTEGER PRIMARY KEY,
  page_number INTEGER NOT NULL,
  line_number INTEGER NOT NULL,
  text_uthmani TEXT NOT NULL,
  font_family TEXT,

  UNIQUE (page_number, line_number)
);

CREATE INDEX idx_mushaf_lines_page
  ON mushaf_lines (page_number, line_number);
```

If you need verse-to-line mapping:

```sql
CREATE TABLE mushaf_line_verses (
  mushaf_line_id INTEGER NOT NULL,
  verse_id INTEGER NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,

  PRIMARY KEY (mushaf_line_id, verse_id, start_offset),
  FOREIGN KEY (mushaf_line_id) REFERENCES mushaf_lines(id),
  FOREIGN KEY (verse_id) REFERENCES verses(id)
);
```

Offsets in complex Unicode text are tricky. If you store offsets, define whether they are UTF-16 code units, Unicode scalar values, or grapheme clusters. For a web React app, UTF-16 offsets are convenient but not semantically ideal. For highlighting, token-based mapping is usually safer.

### FTS5 table

Use an external-content FTS5 table linked to `verses`.

```sql
CREATE VIRTUAL TABLE verses_fts USING fts5(
  search_uthmani_norm,
  search_imlaei_norm,
  content='verses',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 0'
);
```

Why `remove_diacritics 0`?

Because the app is already doing Quran-specific normalization. SQLite's default diacritic handling is not designed specifically for Quranic annotation marks and Arabic orthographic policy. Keep the database tokenizer simple and deterministic, and own the normalization in application code.

Use triggers to keep FTS in sync:

```sql
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
  INSERT INTO verses_fts(rowid, search_uthmani_norm, search_imlaei_norm)
  VALUES (new.id, new.search_uthmani_norm, new.search_imlaei_norm);
END;

CREATE TRIGGER verses_ad AFTER DELETE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, search_uthmani_norm, search_imlaei_norm)
  VALUES ('delete', old.id, old.search_uthmani_norm, old.search_imlaei_norm);
END;

CREATE TRIGGER verses_au AFTER UPDATE ON verses BEGIN
  INSERT INTO verses_fts(verses_fts, rowid, search_uthmani_norm, search_imlaei_norm)
  VALUES ('delete', old.id, old.search_uthmani_norm, old.search_imlaei_norm);

  INSERT INTO verses_fts(rowid, search_uthmani_norm, search_imlaei_norm)
  VALUES (new.id, new.search_uthmani_norm, new.search_imlaei_norm);
END;
```

If the corpus is loaded in bulk, you can rebuild:

```sql
INSERT INTO verses_fts(verses_fts) VALUES ('rebuild');
```

### Exact-match search

For exact normalized search:

```sql
SELECT
  surah_id,
  ayah_number,
  text_uthmani
FROM verses
WHERE search_uthmani_norm = ?
   OR search_imlaei_norm = ?
ORDER BY surah_id, ayah_number;
```

The query parameter must be normalized through the same pipeline used at ingestion time.

### FTS search

For token search:

```sql
SELECT
  v.surah_id,
  v.ayah_number,
  v.text_uthmani,
  bm25(verses_fts) AS rank
FROM verses_fts
JOIN verses v ON v.id = verses_fts.rowid
WHERE verses_fts MATCH ?
ORDER BY rank, v.surah_id, v.ayah_number;
```

Normalize the user's query before passing it to FTS.

### Normalization pipeline

Use one shared normalization function for ingestion and query-time normalization.

Recommended stages:

1. Unicode normalize to NFC.
2. Strip Quranic marks and harakat for search.
3. Optionally fold selected Arabic letter variants.
4. Normalize whitespace.
5. Store the result in `search_uthmani_norm` and/or `search_imlaei_norm`.

Example TypeScript:

```ts
const SEARCH_MARKS_RE =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

type SearchNormalizationOptions = {
  foldAlef?: boolean;
  foldAlefWasla?: boolean;
  foldAlefMaksura?: boolean;
  foldPersianYeh?: boolean;
  foldTehMarbuta?: boolean;
};

const DEFAULT_SEARCH_NORMALIZATION: Required<SearchNormalizationOptions> = {
  foldAlef: true,
  foldAlefWasla: true,
  foldAlefMaksura: true,
  foldPersianYeh: true,
  foldTehMarbuta: false,
};

export function stripDiacritics(verse: string): string {
  return verse.replace(SEARCH_MARKS_RE, "");
}

export function normalizeForQuranSearch(
  input: string,
  options: SearchNormalizationOptions = {},
): string {
  const config = { ...DEFAULT_SEARCH_NORMALIZATION, ...options };

  let value = input.normalize("NFC");
  value = stripDiacritics(value);

  if (config.foldAlef) {
    value = value.replace(/[\u0622\u0623\u0625]/g, "\u0627");
  }

  if (config.foldAlefWasla) {
    value = value.replace(/\u0671/g, "\u0627");
  }

  if (config.foldAlefMaksura) {
    value = value.replace(/\u0649/g, "\u064A");
  }

  if (config.foldPersianYeh) {
    value = value.replace(/\u06CC/g, "\u064A");
  }

  if (config.foldTehMarbuta) {
    value = value.replace(/\u0629/g, "\u0647");
  }

  return value.replace(/\s+/gu, " ").trim();
}
```

### Ingestion flow

```ts
type VerseRecordInput = {
  surahId: number;
  ayahNumber: number;
  textUthmani: string;
  textImlaei?: string;
  pageNumber?: number;
};

type VerseRecordForDb = {
  surah_id: number;
  ayah_number: number;
  text_uthmani: string;
  text_imlaei: string | null;
  search_uthmani_norm: string;
  search_imlaei_norm: string | null;
  page_number: number | null;
};

export function prepareVerseForDb(input: VerseRecordInput): VerseRecordForDb {
  const textUthmani = input.textUthmani.normalize("NFC");
  const textImlaei = input.textImlaei?.normalize("NFC") ?? null;

  return {
    surah_id: input.surahId,
    ayah_number: input.ayahNumber,
    text_uthmani: textUthmani,
    text_imlaei: textImlaei,
    search_uthmani_norm: normalizeForQuranSearch(textUthmani),
    search_imlaei_norm: textImlaei ? normalizeForQuranSearch(textImlaei) : null,
    page_number: input.pageNumber ?? null,
  };
}
```

### Query flow

```ts
export function prepareUserQuery(rawQuery: string): string {
  return normalizeForQuranSearch(rawQuery);
}
```

Exact normalized search:

```ts
const normalized = prepareUserQuery(userQuery);

const rows = db
  .prepare(`
    SELECT surah_id, ayah_number, text_uthmani
    FROM verses
    WHERE search_uthmani_norm = ?
       OR search_imlaei_norm = ?
    ORDER BY surah_id, ayah_number
  `)
  .all(normalized, normalized);
```

FTS search:

```ts
const normalized = prepareUserQuery(userQuery);

const rows = db
  .prepare(`
    SELECT
      v.surah_id,
      v.ayah_number,
      v.text_uthmani,
      bm25(verses_fts) AS rank
    FROM verses_fts
    JOIN verses v ON v.id = verses_fts.rowid
    WHERE verses_fts MATCH ?
    ORDER BY rank, v.surah_id, v.ayah_number
  `)
  .all(normalized);
```

For phrase search, quote and escape the normalized query carefully before using `MATCH`.

### Display flow

Search results should return `text_uthmani` for display:

```tsx
function SearchResult({
  surahId,
  ayahNumber,
  textUthmani,
}: {
  surahId: number;
  ayahNumber: number;
  textUthmani: string;
}) {
  return (
    <article className="search-result">
      <QuranVerseText text={textUthmani} mode="verse" />
      <div className="reference">
        {surahId}:{ayahNumber}
      </div>
    </article>
  );
}
```

Do not highlight search matches by slicing raw Uthmani strings using normalized offsets. Normalization deletes characters, so offsets no longer align. If highlighting is required, build a token map during normalization:

```ts
type NormalizedToken = {
  original: string;
  normalized: string;
  originalStart: number;
  originalEnd: number;
};
```

Then highlight whole tokens or mapped grapheme ranges, not arbitrary code-unit spans guessed from the FTS result.

---

## Summary

- Use **Uthmani text** for display and **Imlaei or normalized text** for search.
- Do not render Uthmani Quran text with generic Arabic fonts and expect correct results.
- Use Quran-specific fonts; for mushaf page fidelity, use **page-specific QCF fonts** or page images.
- Strip harakat and Quranic annotation marks only for search indexing.
- Do not strip letter characters such as `آ`, `أ`, `إ`, `ؤ`, `ئ`, or `ء` as if they were diacritics.
- Prevent orphaned ayah markers by grouping the final word and marker with non-breaking markup.
- CSS justification cannot reliably reproduce mushaf composition; use authoritative line breaks and page-specific fonts for mushaf page mode.
- Store full `text_uthmani` separately from normalized search columns, and drive FTS5 from the normalized columns.
