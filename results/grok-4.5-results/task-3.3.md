# Quran Reading Feature — Technical Design Doc

**Stack context:** Web, React · display of Uthmani text · exact-match search on normalized text · SQLite + FTS5  
**Scope:** Script sources & fonts, search-only diacritic stripping, line-breaking / mushaf justification, storage + normalization pipeline.

---

## 1. Imlaei vs Uthmani, fonts, and why general-purpose Arabic fonts fail

### 1.1 What the two “script text sources” mean

| | **Imlaei (إملائي)** | **Uthmani (عثماني / Uthmanic rasm)** |
|---|---|---|
| **Orthography** | Modern Arabic spelling conventions: full letters where modern readers expect them, fewer “missing” base letters, orthography aligned with contemporary writing. | Traditional rasm of the Uthmanic mushaf: historical spelling (some words omit base letters that modern Arabic would write; other forms preserve archaic skeleton). |
| **Marks** | Usually standard tashkeel (harakat, shadda, sukun). Fewer (or no) specialized Quranic pause / annotation symbols. | Full set of Quranic annotation marks: pause signs (وقف), sajda, small high letters (e.g. small seen, small meem), rub el hizb, end-of-ayah, etc., plus dense tashkeel matching a printed mushaf. |
| **Typical use** | Teaching apps, beginner-friendly reading, “plain Arabic” display, search-friendly source text. | Faithful mushaf-like reading (Hafs ‘an ‘Asim is the common digital baseline), page-aligned apps. |
| **Unicode density** | Mostly Arabic block letters + common combining diacritics. | Same base letters **plus** extensive use of *Arabic Presentation Forms*, *Quranic annotation marks* (e.g. U+06D6–U+06ED), and sometimes presentation-form or specialized sequences that only a Quran-aware font fully covers. |

**Important distinction:** “Uthmani” here is not merely “fancier diacritics on the same letters.” Word *shapes* and *letter presence* can differ from Imlaei for the same ayah (e.g. elongated / suppressed alefs, historical spellings). Treating them as interchangeable display strings will produce wrong words, not just wrong marks.

### 1.2 Why naïvely rendering Uthmani with a general-purpose Arabic font fails

General-purpose Arabic fonts (Noto Naskh Arabic, Tahoma, system UI Arabic, many webfonts) are built for **modern orthography + common tashkeel**. Uthmani Quran text fails for several independent reasons:

1. **Missing glyphs for Quranic annotation marks**  
   Code points such as pause marks, small high letters, end-of-ayah (۝ U+06DD), rub el hizb, etc. often have **no glyph**. The browser shows `.notdef` (□/tofu), blank space, or a fallback font that breaks the line’s visual weight.

2. **Incomplete OpenType Arabic shaping for Quran-specific sequences**  
   Arabic requires GSUB/GPOS (init/medi/fina/isol, lam-alef ligatures, mark positioning). Quran fonts implement **extra** mark stacking, vertical placement for multi-layer tashkeel + annotations, and special ligatures. A general font may:
   - stack marks incorrectly (colliding fatha/shadda/annotation),
   - drop or mis-position secondary marks,
   - fail rare letter + mark combinations used only in the mushaf.

3. **Presentation / rasm expectations**  
   Uthmani digital sources often assume a **specific typeface tradition** (e.g. King Fahd Complex Hafs naskh). Substituting a modern naskh changes letter proportions, kashida habits, and where readers expect marks to sit—even when every code point “exists.”

4. **Mixed fallback = visual breakage**  
   If the primary font lacks a mark, the browser pulls that single combining mark from a fallback font. Combining marks from font B attached to bases from font A almost always **misalign**, looking like random dots above/below the wrong letter.

5. **Some “letters” are not ordinary letters**  
   Small high seen, superscript alef (U+0670), and similar forms are first-class in Quran fonts and afterthoughts (or absent) elsewhere.

**Bottom line:** Wrong/missing glyphs are not a CSS bug; they are a **font coverage + OpenType feature** problem. You need a Quran-specific font (or page fonts), not “any Arabic font.”

### 1.3 Fonts designed for this

| Font / family | Notes |
|---|---|
| **KFGQPC Uthmanic Script HAFS** (King Fahd Glorious Quran Printing Complex) | De facto standard for Hafs Uthmani digital text. Designed around the Complex’s orthography and mark set. |
| **Amiri Quran** / **Amiri Quran Colored** | High-quality open Quran naskh; good mark coverage; often used when KFGQPC licensing/packaging is inconvenient. |
| **Scheherazade New** (SIL) | Broad Arabic coverage including many Quranic marks; more “general scholarly” than pure mushaf replica. |
| **IndoPak / Nastaliq Quran fonts** (e.g. Al Qalam, PDMS-style) | For Indo-Pak script layout (different rasm/visual tradition)—not interchangeable with Madinah Uthmani page fonts. |

Ship **one primary Quran font** for continuous Uthmani reading, subsetted if needed, with `font-display` strategy that avoids flash-of-missing-marks (prefer blocking or carefully staged load for the reading surface).

### 1.4 Standard approach in major Quran apps (including page-specific fonts)

There are two production patterns; serious mushaf UIs often combine them.

#### A. Continuous text + Quran webfont (ayah/surah mode)

- Store Uthmani Unicode strings per ayah.
- Render with **KFGQPC Uthmanic** (or Amiri Quran) via `@font-face`.
- Use proper bidi (`dir="rtl"`, `lang="ar"`), and avoid forcing Latin line-breaking rules onto the ayah run.
- Good for: search results, word-by-word, translation side-by-side, responsive reflow.

```css
@font-face {
  font-family: "KFGQPC Uthmanic Script HAFS";
  src: url("/fonts/UthmanicHafs.woff2") format("woff2");
  font-display: block; /* prefer no partial mark flash on the reader */
  unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}

.quran-uthmani {
  font-family: "KFGQPC Uthmanic Script HAFS", "Amiri Quran", serif;
  direction: rtl;
  font-feature-settings: "liga" 1, "calt" 1; /* depend on font */
  line-height: 2; /* marks need vertical room */
}
```

#### B. Page-specific (per-mushaf-page) font strategy — what major apps do for “mushaf mode”

Apps that replicate the **Madinah mushaf page** (Quran.com-style mushaf view, many native apps) often do **not** reflow free Unicode for page mode. Instead:

1. **One font file per printed page** (or per page range), where glyphs are drawn to match the official page layout—positions of words, line breaks, and sometimes decorative ayah markers are effectively **baked into the font/page asset**.
2. The app loads `p1.woff2` … `p604.woff2` (Madinah 604 pages) **on demand** when the user navigates to that page.
3. Text on the page may be:
   - special codepoint mapping / private-use or page-local encoding where each “character” maps to a pre-positioned glyph, **or**
   - carefully synchronized Unicode with a page font that only contains that page’s glyphs,
   - sometimes paired with **image/SVG fallback** for pixel-perfect fidelity.

**Why this exists:** True mushaf layout is **not** “justify a paragraph of Arabic.” Line breaks, word stretching, and marker placement are editorial/typesetting decisions fixed per page. CSS reflow will never stably match the printed Madinah mushaf.

| Mode | Strategy | Trade-off |
|---|---|---|
| **Surah / list / search** | Continuous Uthmani Unicode + KFGQPC/Amiri | Reflow OK; not page-identical |
| **Mushaf page view** | Page font (or image) per page + lazy load | Fidelity high; heavy assets; hard to highlight arbitrary substrings without metadata |
| **Hybrid (common)** | Page mode for reading; Unicode mode for search/word-by-word | Two pipelines; map page ↔ ayah via metadata |

**Recommendation for a React web reader:**

- **Reader default:** continuous Uthmani + KFGQPC (or Amiri Quran).
- **Optional “Mushaf pages” mode:** page fonts or high-res page images + ayah bounding-box metadata if you need true page fidelity.
- Never use a system UI font for Uthmani body text.

---

## 2. `stripDiacritics(verse)` — search indexing only

### 2.1 Purpose and hard rule

- **Index / query side only:** run this (plus further normalization in §4) when building FTS documents and when normalizing the user query.
- **Display side:** always store and render **full** Uthmani (or Imlaei) text with all tashkeel and Quranic marks intact.
- Do **not** use the stripped string for UI.

### 2.2 Exact Unicode ranges / code points to strip

These are **marks and Quranic annotations**, not base letters. Ranges are inclusive.

| Range / code point | Name / role | Strip for search? |
|---|---|---|
| **U+0610–U+061A** | Arabic sign marks (e.g. number sign, footnote, honorifics used as marks) | **Yes** |
| **U+064B–U+065F** | Tashkeel / harakat block: fathatan, dammatan, kasratan, fatha, damma, kasra, shadda, sukun, and related combining marks in this span | **Yes** (with caution on U+0653–U+0655 — see §2.3) |
| **U+0670** | Arabic letter superscript alef | **Yes** (annotation-style; not a full base letter for search identity) |
| **U+06D6–U+06ED** | Quranic annotation marks (pause marks, small high letters, end-of-ayah ornament companions, etc.) | **Yes** |
| **U+06DF–U+06E8** | (subset of above) small high rounded zero, inverted small high, small high noon, etc. | **Yes** |
| **U+08D3–U+08FF** | Arabic Extended-A (additional Quranic / extended marks where present in source) | **Yes** (marks in this block) |
| **U+0640** | Tatweel / kashida (ـ) | **Yes for search** (elongation only; does not change letter identity) |
| **U+06DD** | Arabic end of ayah (۝) when embedded in verse strings | **Yes for search** (structural, not lexical) |
| **U+06DE** | Start of rub el hizb | **Yes for search** |
| Optional decorative | U+06E9 (place of sajdah), etc., if present as separate chars | **Yes for search** |

**Practical regex (BMP-focused, explicit):**

```js
// Combining / annotation marks commonly present in Quran Unicode sources.
// NOTE: This is for SEARCH INDEXING ONLY — never feed display text through this alone as UI.
const STRIP_MARKS_RE = new RegExp(
  [
    "[\u0610-\u061A]",       // Arabic sign marks
    "[\u064B-\u065F]",       // harakat + related combining (see keep-list caveats)
    "\u0670",                // superscript alef
    "[\u06D6-\u06ED]",       // Quranic annotation marks
    "[\u08D3-\u08FF]",       // Arabic Extended-A marks (as used)
    "\u0640",                // tatweel / kashida
    "\u06DD",                // end of ayah symbol (if stored in-line)
    "\u06DE",                // rub el hizb
  ].join("|"),
  "g"
);
```

If your source can include **Arabic Presentation Forms-A/B** only for display, normalize to NFC and prefer **logical Arabic block** letters in the index pipeline (§4); do not rely on stripping alone to unify presentation forms.

### 2.3 Code points you must **NOT** strip (letter identity, not “just diacritics”)

Removing these **changes the letter / word**, not merely vocalization. At least two are required; more are listed for safety.

| Code point | Character | Why you must keep it |
|---|---|---|
| **U+0621** | ء ARABIC LETTER HAMZA | Free-standing hamza is a **letter**, not a haraka. |
| **U+0622** | آ ARABIC LETTER ALEF WITH MADDA ABOVE | Precomposed alef+madda; stripping “madda” by deleting this code point **deletes the letter**. |
| **U+0623** | أ ARABIC LETTER ALEF WITH HAMZA ABOVE | Precomposed letter; not optional decoration. |
| **U+0624** | ؤ ARABIC LETTER WAW WITH HAMZA ABOVE | Letter identity. |
| **U+0625** | إ ARABIC LETTER ALEF WITH HAMZA BELOW | Letter identity. |
| **U+0626** | ئ ARABIC LETTER YEH WITH HAMZA ABOVE | Letter identity. |
| **U+0627** | ا ARABIC LETTER ALEF | Base letter. |
| **U+0649** | ى ALEF MAKSURA | Distinct from ي in orthography; do not treat as a mark. |
| **U+064A** | ي YEH | Base letter. |
| **U+0629** | ة TEH MARBUTA | Base letter (you may *map* it to ه in a later normalization step, but you do not “strip” it as a diacritic). |

**Critical nuance on U+0653 / U+0654 / U+0655:**

- **U+0653** ARABIC MADDAH ABOVE, **U+0654** HAMZA ABOVE, **U+0655** HAMZA BELOW are *combining* marks.
- They sit inside the U+064B–U+065F strip range. If the source uses **decomposed** `ا + U+0653` instead of precomposed `آ (U+0622)`, blindly stripping U+0653 turns آ-like sequences into bare ا and **collapses distinct forms**.
- **Search-index policy (recommended):**
  1. **NFC-normalize first.**
  2. **Compose / canonicalize** hamza and madda onto base letters where possible (or map all alef variants to a single search alef *deliberately* in a later step).
  3. Only then strip pure vocalization marks.
  4. If you strip U+0653–U+0655 as part of the harakat range, you **must** either (a) compose first so U+0622 etc. exist, or (b) **exclude** U+0653–U+0655 from the strip set and handle them in an explicit alef/hamza canonicalization pass.

For the function below, we **exclude U+0653–U+0655 from stripping** so we never destroy letter-modifying marks by accident; §4’s pipeline then maps alef/hamza variants intentionally.

### 2.4 Implementation

```js
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
```

**At least two code points you must not strip (as requested):**

1. **U+0622** (آ ALEF WITH MADDA ABOVE) — removing it is deleting a letter, not a diacritic.  
2. **U+0621** (ء HAMZA) — hamza is a letter; also keep **U+0623** (أ) for the same reason.

---

## 3. Rendering strategy: no orphan verse-end markers; mushaf-like justification

### 3.1 Requirements

**(a)** A verse-end marker (**۝** + ayah number) must **never** wrap onto a line alone.  
**(b)** Horizontal justification should feel like a mushaf: prefer **kashida (tatweel) stretching** inside words / at elongation points over huge gaps between words — or be honest when the platform cannot do that.

### 3.2 (a) Never orphan ۝ + number

Treat the end marker and number as a **single unbreakable cluster**, glued to the **last word** of the verse (or at least to each other).

**Recommended DOM structure (React):**

```jsx
function Verse({ text, number }) {
  return (
    <span className="verse" dir="rtl" lang="ar">
      <span className="verse-body">{text}</span>
      {/* NBSP / word-joiner glue; nowrap cluster for marker+number */}
      <span className="verse-end" aria-label={`Ayah ${number}`}>
        {"\u00A0"}
        <span className="verse-end-cluster">
          <span className="ayah-symbol">{"\u06DD"}</span>
          <span className="ayah-number">{number}</span>
        </span>
      </span>
    </span>
  );
}
```

```css
.verse {
  direction: rtl;
  unicode-bidi: isolate; /* keep each verse’s bidi clean in mixed UI */
}

/* Marker + number never split; prefer staying with previous word */
.verse-end-cluster {
  white-space: nowrap;
  display: inline;
}

/* Optional: discourage break before the whole end cluster */
.verse-end {
  white-space: nowrap;
}

/*
 * Stronger glue (optional): insert U+2060 WORD JOINER between last
 * letter and marker in the data layer if you still see orphans in
 * some browsers when the number is long (3 digits).
 */
```

**Additional tactics:**

| Technique | Role |
|---|---|
| `white-space: nowrap` on marker+number | Primary fix for (a) |
| NBSP (`U+00A0`) before cluster | Soft glue to previous token |
| Word joiner (`U+2060`) | Break opportunity killer without visible space |
| Keep number **inside** the ۝ design (single glyph / CSS) | Some fonts draw ۝ as a frame; number centered via CSS absolutely — then only one atomic inline box wraps |
| Avoid `display: inline-block` on large chunks | Large inline-blocks create awkward “boxes” and worse justification |

**React list of verses:** render spaces *between* verses carefully; do not put the marker in a separate flex item that can land on its own row.

```jsx
// Bad: flex child can sit alone on a row
// <div className="flex"><p>{text}</p><span>۝{n}</span></div>

// Good: one inline run per verse inside a justified paragraph
function SurahText({ verses }) {
  return (
    <p className="mushaf-paragraph" dir="rtl" lang="ar">
      {verses.map((v) => (
        <Verse key={v.id} text={v.uthmani} number={v.ayah} />
      ))}
    </p>
  );
}
```

### 3.3 (b) Mushaf-like justification: what CSS can and cannot do

#### What a printed mushaf does

- Lines are full measure (almost).
- Extra width is absorbed by **kashida** (elongating curves of selected letters: سـ ـ صـ ـ ـن etc.) and controlled letter/word spacing according to traditional rules — **not** by evenly huge word gaps alone.
- Line breaks are **editorial**, not “whatever the browser picks.”

#### What CSS can do today

| CSS | Support / behavior for Arabic Quran |
|---|---|
| `text-align: justify` | Works; default justification is **inter-word** (and some inter-character) spacing. |
| `text-justify: inter-word` | Explicit word-spacing justification — **widely what you actually get**. |
| `text-justify: kashida` | **Specified** for Arabic-script kashida justification, but **browser support is incomplete / inconsistent** (historically IE/legacy Edge had more visible kashida behavior; modern Chromium/Firefox/Safari do **not** reliably implement true mushaf-quality kashida justification for arbitrary web fonts). |
| `letter-spacing` / `word-spacing` | Crude; breaks calligraphic color; marks can look detached. |
| `font-feature-settings` / `font-variation-settings` | Only if the font exposes usable features; not a full justification engine. |
| `text-align-last` | Last line usually stays start-aligned (RTL: right); mushaf last lines of a page may still be full — CSS won’t match page logic. |

```css
.mushaf-paragraph {
  direction: rtl;
  text-align: justify;
  /* Intent: kashida — do not depend on this alone in production */
  text-justify: kashida; /* graceful degradation to inter-word where unsupported */
  line-height: 1.9–2.2; /* give marks room; tune per font */
  hyphens: none;
  -webkit-hyphens: none;
  overflow-wrap: normal;   /* do not smash Arabic letters mid-glyph run */
  word-break: normal;
}
```

#### What CSS **cannot** honestly do today

1. **True mushaf kashida placement** (which letters elongate on which lines) — needs a text-shaping / layout engine aware of Arabic justification rules, or pre-typeset pages.  
2. **Stable line breaks matching Madinah (or any) printed page** across viewport widths.  
3. **Guaranteed** `text-justify: kashida` across Chromium, Firefox, and Safari with KFGQPC/Amiri.  
4. Orphan/widow control at the level of “ayah semantics” without DOM structure (CSS `widows`/`orphans` apply to block lines, not “marker clusters,” and are weakly supported for this use).

### 3.4 Honest fallback strategy (recommended)

**Tier 1 — Production web default (responsive Uthmani reader)**

- Continuous Unicode + Quran font.
- `text-align: justify` (accept **inter-word** spacing as the real engine).
- Atomic **nowrap** verse-end clusters (§3.2).
- Generous `line-height`; avoid justifying tiny narrow columns (set a min width for the reader column).
- Optional: slightly increase font size rather than over-justify.

**Tier 2 — Improved “calligraphic” stretch (if you invest)**

- Custom layout pass (canvas, SVG, or WASM shaping with HarfBuzz): measure line, insert tatweel `ـ` at allowed elongation points, re-shape.  
- Or use a library/engine that does Arabic justification properly.  
- This is real work; not a few CSS properties.

**Tier 3 — True mushaf fidelity**

- **Page fonts** or **page images** + ayah hotspot metadata (the major-app approach in §1.4).  
- No CSS justification problem because lines are pre-finalized.

**Product honesty for stakeholders:**  
> “We will not claim browser CSS produces Madinah-mushaf kashida. We prevent orphan ayah markers with unbreakable clusters, use justified RTL paragraphs, and ship a Quran font. Pixel-true mushaf layout requires page fonts/images or a custom shaper.”

---

## 4. Storage: exact-match search on normalized text + full Uthmani display (SQLite FTS5)

### 4.1 Goals

| Goal | Mechanism |
|---|---|
| Display full Uthmani | `text_uthmani` (and optional `text_imlaei`) never stripped |
| Exact-match search on normalized form | Separate `text_normalized` + FTS5 index on that column (or contentless FTS with external content) |
| Stable identity | `surah`, `ayah` (and optional `page`, `juz`, `hizb`) |
| Query path | Normalize user query with **same pipeline** as index |

“Exact-match” here means: after identical normalization, FTS exact token / phrase match — not fuzzy OCR. Still use FTS5 for tokenization/speed; constrain with phrase queries or whole-field equality as needed.

### 4.2 Normalization pipeline (index + query)

Apply **in this order** for both indexing and search queries:

```
1. Unicode NFC
2. Remove tatweel U+0640 (also done in stripDiacritics)
3. stripDiacritics()  — §2 (tashkeel + Quranic annotations; keep hamza/madda letters)
4. Canonicalize alef / hamza / madda for search (product choice — document it):
     آ أ إ ٱ → ا
     ؤ → و   (optional; many apps map ؤ→و and ئ→ي)
     ئ → ي
     ء        keep or strip depending on desired recall (often keep)
5. Yeh / alef maqsura policy (pick one and stick to it):
     ى → ي   (common for search recall)
6. Teh marbuta policy:
     ة → ه   (common) OR keep ة
7. Remove remaining punctuation / decorative symbols not already stripped
8. Collapse whitespace; trim
9. (Optional) NFKC only if you must fold presentation forms; test carefully —
     prefer fixing source to logical Arabic letters at ingest
```

```js
function normalizeForSearch(verse) {
  let s = stripDiacritics(verse); // includes NFC + mark strip

  // Alef variants → bare alef (search unification)
  s = s.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627"); // آ أ إ ٱ → ا

  // Optional hamza-on-seat mappings (higher recall, lower precision)
  s = s.replace(/\u0624/g, "\u0648"); // ؤ → و
  s = s.replace(/\u0626/g, "\u064A"); // ئ → ي

  // Alef maqsura → yeh
  s = s.replace(/\u0649/g, "\u064A"); // ى → ي

  // Teh marbuta → heh
  s = s.replace(/\u0629/g, "\u0647"); // ة → ه

  // Remove any leftover non-letter/digit/space if desired
  s = s.replace(/[^\u0621-\u063A\u0641-\u064A\s0-9]/g, "");

  return s.replace(/\s+/g, " ").trim();
}
```

**Exact-match note:** Because of steps 4–6, “exact” is **exact on the normalized alphabet**, not byte-identical to display text. That is what users expect (“find اقل regardless of أ/إ/آ”).

### 4.3 SQLite schema

```sql
-- Core ayah table: display + normalized + metadata
CREATE TABLE ayah (
  id              INTEGER PRIMARY KEY,           -- surah*1000+ayah or serial
  surah           INTEGER NOT NULL CHECK (surah BETWEEN 1 AND 114),
  ayah            INTEGER NOT NULL CHECK (ayah >= 1),
  page            INTEGER,                       -- Madinah page if known
  juz             INTEGER,
  hizb            INTEGER,
  ruku            INTEGER,

  -- DISPLAY (never stripped)
  text_uthmani    TEXT    NOT NULL,
  text_imlaei     TEXT,                          -- optional second script source

  -- SEARCH (pipeline output)
  text_normalized TEXT    NOT NULL,

  -- Optional word-count / length helpers
  char_len_display INTEGER,
  char_len_norm    INTEGER,

  UNIQUE (surah, ayah)
);

CREATE INDEX idx_ayah_page ON ayah(page);
CREATE INDEX idx_ayah_surah ON ayah(surah);

-- FTS5 over normalized text for fast exact/phrase search.
-- content=ayah keeps FTS in sync with external content table.
CREATE VIRTUAL TABLE ayah_fts USING fts5(
  text_normalized,
  content='ayah',
  content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 0'  -- we already normalize; don't double-strip wrongly
);

-- Triggers: keep FTS in sync on write
CREATE TRIGGER ayah_ai AFTER INSERT ON ayah BEGIN
  INSERT INTO ayah_fts(rowid, text_normalized)
  VALUES (new.id, new.text_normalized);
END;

CREATE TRIGGER ayah_ad AFTER DELETE ON ayah BEGIN
  INSERT INTO ayah_fts(ayah_fts, rowid, text_normalized)
  VALUES ('delete', old.id, old.text_normalized);
END;

CREATE TRIGGER ayah_au AFTER UPDATE ON ayah BEGIN
  INSERT INTO ayah_fts(ayah_fts, rowid, text_normalized)
  VALUES ('delete', old.id, old.text_normalized);
  INSERT INTO ayah_fts(rowid, text_normalized)
  VALUES (new.id, new.text_normalized);
END;
```

**Optional:** separate table for word-level rows if you need word-by-word highlighting mapped to Uthmani tokens (display tokens ≠ normalized tokens; store both).

```sql
CREATE TABLE ayah_word (
  id           INTEGER PRIMARY KEY,
  ayah_id      INTEGER NOT NULL REFERENCES ayah(id),
  word_index   INTEGER NOT NULL,          -- 0-based in display segmentation
  text_uthmani TEXT    NOT NULL,          -- display token
  text_normalized TEXT NOT NULL,          -- search token
  UNIQUE (ayah_id, word_index)
);
```

### 4.4 Ingest pipeline (pseudocode)

```js
function ingestAyah({ surah, ayah, textUthmani, textImlaei, page, ... }) {
  const text_normalized = normalizeForSearch(textUthmani);
  // INSERT INTO ayah (... text_uthmani, text_normalized ...)
}

function searchExact(userQuery) {
  const q = normalizeForSearch(userQuery);
  // Prefer phrase match for multi-word:
  // SELECT a.* FROM ayah_fts f
  // JOIN ayah a ON a.id = f.rowid
  // WHERE ayah_fts MATCH '"normalized words here"'
  //
  // For whole-ayah equality:
  // SELECT * FROM ayah WHERE text_normalized = ?
}
```

**FTS5 query hygiene:**

- Always run `normalizeForSearch` on the raw user string before building `MATCH`.
- Escape FTS5 special characters (`"`, `*`, etc.) after normalization.
- For true exact phrase: use FTS phrase quotes on the normalized string.
- For exact full-ayah: `WHERE text_normalized = ?` on the base table (btree/UNIQUE helper index optional).

```sql
CREATE INDEX idx_ayah_norm ON ayah(text_normalized); -- equality / prefix helpers
```

### 4.5 What lives where (React)

| Layer | Holds |
|---|---|
| SQLite / API | `text_uthmani` for render; FTS on `text_normalized` |
| React state | Current surah/page; selected ayah ids from search |
| CSS / fonts | KFGQPC or Amiri Quran on `.quran-uthmani` only |
| Search box | Normalize on submit (and optionally debounce normalize for suggestions) |

```jsx
// Display path — never strip
<span className="quran-uthmani">{ayah.text_uthmani}</span>

// Search path
const hits = await api.search(normalizeForSearch(query));
```

---

## 5. Summary decisions

1. **Imlaei** ≈ modern orthography; **Uthmani** ≈ mushaf rasm + full Quranic marks. General Arabic fonts miss annotation glyphs and correct mark positioning → use **KFGQPC Uthmanic / Amiri Quran**; for page-identical mushaf mode use **per-page fonts/images** like major apps.  
2. **`stripDiacritics`** strips U+0610–061A, U+064B–0652 & U+0656–065F, U+0670, U+06D6–06ED, U+08D3–08FF, tatweel, etc., for **index only**. **Do not strip** letter code points such as **U+0622 (آ)** and **U+0621 (ء)** (also keep U+0623–0626); exclude or pre-canonicalize **U+0653–0655**.  
3. **Orphan ۝+number:** `nowrap` cluster + NBSP/word-joiner glued to verse end. **Justification:** CSS `text-align: justify` is real; **`text-justify: kashida` is not dependable**. Honest fallback = inter-word justify + Quran font; true mushaf = page fonts or custom shaper.  
4. **Schema:** `ayah(text_uthmani, text_normalized, …)` + **FTS5** on `text_normalized` with identical normalize-on-query pipeline (NFC → strip marks → alef/yeh/teh policy).

---

## 6. Out of scope / follow-ups

- Tajweed colorization rules and tokenization.  
- Multi-qira’at sources (Warsh, etc.) as separate `script` columns.  
- Offline font subsetting and RTL clipboard behavior.  
- Accessibility: expose ayah numbers to AT even when visually inside ۝.
