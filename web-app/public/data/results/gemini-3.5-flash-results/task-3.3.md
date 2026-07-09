# Technical Design Document: Quran Reading and Search Feature (Web/React)

This design document outlines the technical implementation for rendering, storing, and searching Quranic text in a React web application.

---

## 1. Script Typology and Font Rendering Architecture

### Imlaei vs. Uthmani Script
* **Imlaei (Orthographic / Modern Arabic Script):** The standard modern writing system used in everyday Arabic publications. It simplifies spelling conventions, normalizes the rules for writing the *hamza*, and writes long vowels explicitly.
* **Uthmani (Ottoman / Rasm Uthmani Script):** The classical orthography (*rasm*) in which the Quran was originally transcribed during the caliphate of Uthman ibn Affan. It contains archaic spelling rules, unique *hamza* placements, silent letters, and superscript guide letters (e.g., superscript alif, small ya, small seen) to preserve the exact oral recitation tradition.

### Why General-Purpose Fonts Fail to Render Uthmani Text
1. **Missing Glyphs:** General-purpose Arabic fonts (e.g., Arial, Tahoma, Amiri standard) do not contain glyph definitions for specialized Quranic Unicode characters. These include sequential tanween (used to denote tajweed rules like *idgham* or *ikhfa*), signs of stop (*waqf* markers like U+06D6 to U+06DB), and specific small/superscript letters. When rendered, these characters fallback to system defaults or display as broken square boxes (`` or `[]`).
2. **Complex Stacking & Positioning (OpenType GPOS):** Quranic script requires multiple layers of diacritics to stack vertically on a single base letter (e.g., a consonant with a *shadda*, a *fatha*, a *dagger alif*, and a *waqf* sign above it). General-purpose fonts lack the complex OpenType Glyph Positioning (GPOS) tables required to coordinate this vertical placement, leading to overlapping, misaligned, or unreadable glyph collisions.

### Specialized Fonts
To render Uthmani script correctly, you must use fonts engineered specifically for Quranic typography:
* **KFGQPC Uthman Taha Naskh:** Developed by the King Fahd Glorious Quran Printing Complex. It is the gold standard for representing the Medina Mushaf style.
* **Amiri Quran:** An extension of the classical Amiri typeface designed specifically for Quranic typesetting.
* **Scheherazade New:** An Arabic font designed by SIL International that offers extensive support for Quranic annotations.

### Standard Approach & Page-Specific Font Strategy
To replicate the layout of the standard printed 604-page Medina Mushaf (where each page begins and ends exactly at a verse boundary and lines are perfectly aligned), major Quran applications (e.g., Quran.com) do not render dynamic, responsive Arabic text using a single font file.

Instead, they employ a **page-specific font strategy**:
1. **Split Assets:** The app loads 604 separate web fonts (e.g., `QCF2001.woff2` to `QCF2604.woff2`), one for each page of the Quran.
2. **Private Use Area (PUA) Mapping:** In the database, the verse text for a given page is stored as a sequence of custom-mapped Unicode characters residing in the Private Use Area (PUA) block.
3. **Dynamic Loading:** As the user scrolls or navigates to page $N$, the application dynamically fetches the corresponding page font and renders that page's text using those specific glyph mappings. This guarantees that line breaks, letter stretching, and diacritic placement remain exactly identical to the physical printed Mushaf regardless of browser rendering engines.

---

## 2. Text Normalization and Search Indexing

To index the text for search, all diacritics and annotation marks must be stripped. However, the stripping process must not modify base letters which would distort semantic meaning and corrupt search matches.

### JavaScript Implementation
The following function normalizes the input using **Unicode Normalization Form C (NFC)** before removing diacritics to ensure that precomposed Arabic characters (like `آ`) remain intact rather than getting split into separate base and diacritic components.

```javascript
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
```

### Unicode Ranges and Code Points

#### Stripped Ranges/Code Points
* `[\u064B-\u0652]`: Standard Tashkeel (short vowels and pronunciation guides: *fatha*, *damma*, *kasra*, *tanween*, *shadda*, *sukun*).
* `[\u0653-\u065F]`: Combining Arabic diacritical marks (e.g., combining *maddah* and combining *hamza*).
* `\u0670`: Superscript Alif (*dagger alif*).
* `[\u06D6-\u06ED]`: Quranic annotational characters (such as stop/pause letters like *صلى*, *قلى*, *ج*, *لا*, and the End of Ayah marker U+06DD).

#### Core Letters That Must NOT Be Stripped
* **`U+0621` (Arabic Letter Hamza - ء):** This is a standalone, independent base letter representing a glottal stop. Removing it changes the spelling and root meaning of the word (e.g., `مَاء` becomes `ما`).
* **`U+0622` (Arabic Letter Alef with Madda Above - آ):** This is a precomposed base letter representing a glottal stop followed by a long vowel. Stripping it or decomposing it incorrectly deletes critical letters or changes them into basic alifs, which invalidates exact-match search lookups.

---

## 3. Responsive Mushaf Rendering & Typography

### Preventing Verse-End Marker Wrapping
The end of a verse is symbolized by the End of Ayah sign (`۝` U+06DD) containing the verse number. It is critical that this marker never wraps onto a new line by itself.

#### Solution
Wrap the final word of the verse and the verse-end marker together inside a non-wrapping container. In React/JSX:

```jsx
function VerseText({ text, verseNumber }) {
  const words = text.trim().split(' ');
  const lastWord = words.pop();
  const mainText = words.join(' ');

  return (
    <span className="quran-verse">
      {mainText}{' '}
      <span className="no-wrap-end" style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
        {lastWord}
        <span className="verse-marker" style={{ marginLeft: '4px', fontFeatureSettings: '"tnum"' }}>
          &#x06DD;{verseNumber}
        </span>
      </span>
    </span>
  );
}
```
*Alternatively, you can join the last word and the marker using the Unicode **Word Joiner (WJ, U+2060)** or a **Non-Breaking Space (NBSP, U+00A0)**.*

---

### Line Justification: Kashida vs. Word Spacing
Justification in classical Arabic text is traditionally achieved using **Kashida** (or *Tatweel*, U+0640), which stretches the connections between letters within words rather than expanding the blank space between words.

```
Standard justification:   [ Word ]      [ Spaced ]      [ Word ]
Kashida justification:    [ Wo———rd ]   [ Spaced ]   [ Wo———rd ]
```

#### CSS Capabilities and Limits
* **What CSS Can Do:**
  * `text-align: justify;` combined with `text-justify: inter-word;` will expand spaces between words. This works reliably across all browsers but lacks classical calligraphic flow.
  * In theory, the CSS Text Module Level 3 defines `text-justify: inter-character;` which is intended to insert kashidas. 
* **What CSS Cannot Do (Limitations):**
  * Browser implementation of Arabic kashida-based justification is highly inconsistent. Some browsers (like Safari) ignore it, while others (like Chrome/Blink) apply naive stretching that breaks cursive letter connections or deforms font kerning rules.

#### Industry Fallbacks for Perfect Justification
1. **Pre-Rendered Page Fonts (The Medina Mushaf Approach):** Using a page-by-page web font where each page's line contains the exact kashida ligatures baked directly into the glyph structures. The line is rendered as a fixed string, and minor adjustment is handled by the browser's standard layout.
2. **Absolute SVGs / Word-by-Word Vectors:** Render each line as a scaling SVG container. This guarantees identical typography across all mobile devices and desktop browsers at the cost of document searchability and text selection.
3. **Dynamic Font-Feature-Settings:** Some modern fonts support OpenType features (like `calt` for contextual alternates, or custom stylistic sets) that automatically adjust letter lengths. Setting `font-variant-ligatures: common-ligatures` is essential to keep letters connected during justification.

---

## 4. Storage & Search Database Schema

For exact-match search, the database stores a fully normalized version of the text alongside the raw Uthmani text.

### SQLite FTS5 Schema

```sql
-- 1. Base table storing the canonical verse information
CREATE TABLE verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    surah_number INTEGER NOT NULL,
    ayah_number INTEGER NOT NULL,
    text_uthmani TEXT NOT NULL,       -- Complete raw Uthmani text with diacritics/annotations
    text_normalized TEXT NOT NULL,    -- Normalized, plain Arabic text for search
    page_number INTEGER NOT NULL,     -- Mushaf page number (1-604)
    juz_number INTEGER NOT NULL,
    UNIQUE(surah_number, ayah_number)
);

-- 2. SQLite FTS5 External Content Virtual Table
-- External content matches the main 'verses' table to avoid duplicating storage.
CREATE VIRTUAL TABLE verses_fts USING fts5(
    text_normalized,
    content='verses',
    content_rowid='id'
);

-- 3. Automatic Triggers to Keep FTS5 Index Synchronized
CREATE TRIGGER verses_after_insert AFTER INSERT ON verses BEGIN
    INSERT INTO verses_fts(rowid, text_normalized) 
    VALUES (new.id, new.text_normalized);
END;

CREATE TRIGGER verses_after_delete AFTER DELETE ON verses BEGIN
    INSERT INTO verses_fts(verses_fts, rowid, text_normalized) 
    VALUES('delete', old.id, old.text_normalized);
END;

CREATE TRIGGER verses_after_update AFTER UPDATE ON verses BEGIN
    INSERT INTO verses_fts(verses_fts, rowid, text_normalized) 
    VALUES('delete', old.id, old.text_normalized);
    INSERT INTO verses_fts(rowid, text_normalized) 
    VALUES (new.id, new.text_normalized);
END;
```

---

### The Normalization Pipeline

To prepare the `text_normalized` field, the text is run through a normalization pipeline. Here is the conceptual flow implemented in Python or Node.js before inserting records into the database:

1. **NFC Normalization:** Run standard Unicode NFC normalization to compose base characters with their diacritics.
2. **Remove Diacritics and Annotations:** Use the custom `stripDiacritics()` routine (stripping tashkeel, dagger alif, and pause markers).
3. **Normalize Letter Variants:**
   * Map all variations of **Alif** (`أ`, `إ`, `آ`, `ٱ`) to a plain Alif (`ا`).
   * Map **Taa Marbouta** (`ة`) to **Haa** (`ه`) to handle search queries that omit the dots.
   * Map **Alif Maqsoora** (`ى`) to **Yaa** (`ي`).
4. **Trim Whitespace:** Replace multiple spaces with a single space.

#### Normalization Function Example (Node.js/Python-like JS helper)
```javascript
function prepareForSearchIndex(rawUthmaniText) {
  // Step 1 & 2: NFC and Diacritic stripping
  let text = stripDiacritics(rawUthmaniText);
  
  // Step 3: Normalize letter shapes
  text = text
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // أ, إ, آ, ٱ -> ا
    .replace(/\u0629/g, '\u0647')                     // ة -> ه
    .replace(/\u0649/g, '\u064A');                     // ى -> ي

  // Step 4: Clean up spacing
  return text.replace(/\s+/g, ' ').trim();
}
```

---

### Query Patterns

#### 1. Exact-Match Search (Indexed via Normalization)
When the user types a query, normalize their search input using the same pipeline, then query the virtual table:

```javascript
// Example client-side query handler
function searchVerses(db, userQuery) {
  const normalizedQuery = prepareForSearchIndex(userQuery);
  
  // exact-match query matching tokens in order
  const sql = `
    SELECT v.surah_number, v.ayah_number, v.text_uthmani, v.page_number
    FROM verses v
    JOIN verses_fts f ON v.id = f.rowid
    WHERE f.text_normalized MATCH ? 
    ORDER BY v.surah_number, v.ayah_number;
  `;
  
  return db.prepare(sql).all(`"${normalizedQuery}"`); // Wrap in quotes for exact sequence matching
}
```

This database architecture offers **O(1) storage overhead** for indexing via external content tables, while ensuring fast, diacritic-insensitive, letter-tolerant queries that retrieve the original beautiful Uthmani text.
