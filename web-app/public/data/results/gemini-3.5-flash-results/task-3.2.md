# Arabic Typography Web Implementation Guide

This guide addresses 6 common real-world Arabic typography problems encountered in web applications, explaining their technical root causes, concrete CSS/HTML/font-level fixes, and any associated trade-offs.

---

## 1. The "Allah" Ligature (الله) Consistency

### (a) Technical Cause
The word "الله" (Allah) is a sacred ligated glyph in Arabic. 
* **OpenType Tables:** In high-quality Arabic typefaces, this ligation is mapped in the font's OpenType Layout tables—specifically within the `GSUB` (Glyph Substitution) table. It is typically defined under the `rlig` (Required Ligatures) or `ccmp` (Glyph Composition/Decomposition) features, and sometimes in `liga` (Standard Ligatures) or `dlig` (Discretionary Ligatures).
* **Font Inconsistencies:** Not all fonts implement this ligature, or they implement it under different features. Some simplified or poorly designed web fonts lack the glyph representation or the substitution rules entirely, fallback rendering it as four separate letters: Alif (ا), Lam (ل), Lam (ل), and Ha (ه), styled with standard cursive joining.
* **Feature Activation:** If the browser or CSS disables standard ligatures (e.g., `font-variant-ligatures: no-common-ligatures`), the browser will skip standard `GSUB` lookups, resulting in separate letters.

### (b) Concrete Fix & Tradeoffs
To ensure consistent rendering across the web app, control the OpenType features explicitly:

```css
/* Force standard and required ligatures in CSS */
.arabic-text {
  font-variant-ligatures: common-ligatures;
  font-feature-settings: "rlig" on, "liga" on, "ccmp" on;
}
```

* **Forced De-ligation (Alternative):** If visual consistency requires that the ligature *never* renders (due to a mixed font stack where some fonts can't support it), you can turn it off:
  ```css
  .arabic-text-no-lig {
    font-variant-ligatures: no-common-ligatures;
    font-feature-settings: "liga" off, "rlig" off;
  }
  ```
* **HTML Intervention:** You can insert a Zero-Width Non-Joiner (`&zwnj;` / `\u200C`) between characters (e.g., `ال&zwnj;ل&zwnj;ه`) to prevent the shaper from joining them into the ligature.
* **Tradeoffs:** Disabling required ligatures (`rlig`) or inserting `ZWNJ` can make text look typographically incorrect to native readers, and inserting invisible control characters in the HTML degrades searchability (SEO) and copy-paste behavior. The best solution is to use a high-quality, unified Arabic webfont (e.g., *Amiri*, *Cairo*, *Noto Sans Arabic*) and ensure `common-ligatures` is active.

---

## 2. Letter-Spacing Shatters Cursive Joining

### (a) Technical Cause
* **Cursive Script Mechanics:** Arabic is a cursive script where letters connect dynamically based on their position (isolated, initial, medial, final). The text shaping engine (e.g., HarfBuzz, Uniscribe, CoreText) processes the characters and selects the correct glyph variant using OpenType `GSUB` tables, connecting them seamlessly at specific coordinates.
* **The `letter-spacing` Conflict:** The CSS `letter-spacing` property is designed to insert a fixed physical gap between character units. Historically, and in many browser implementations, applying `letter-spacing` overrides the shaping engine's continuous path, inserting blank space between cursively joined glyphs. This shatters the words into disconnected, illegible segments.
* **CSS Specification:** While CSS Text Module Level 3 specifies that `letter-spacing` should not apply to cursive scripts, browser support remains inconsistent, and applying positive letter-spacing frequently breaks the cursive connections.

### (b) Concrete Fix & Tradeoffs
* **The Fix:** Reset `letter-spacing` to `normal` for all Arabic content. Do not use tracking/letter-spacing for luxury styles.
  ```css
  [lang="ar"], .arabic-text {
    letter-spacing: 0 !important; /* Force browser default */
  }
  ```
* **Typographic Alternative (Justification/Kashida):** In Arabic typography, spacing/elongation is traditionally achieved using **kashida** (or *tatweel*), which inserts elongation strokes (ـ, Unicode `U+0640`) to fill space instead of white space.
  ```css
  .luxury-headline {
    text-align: justify;
    text-justify: inter-character; /* Instructs the shaper to use kashidas */
  }
  ```
* **Tradeoffs:** `text-justify: inter-character` or `kashida` relies heavily on browser support and font implementation (the font must have well-designed tatweel segments). Manual insertion of the kashida character (`ـ`) in HTML changes the raw string, which breaks search matching and screen reader accessibility.

---

## 3. Numeral Discrepancies (Western vs. Eastern Arabic Numerals)

### (a) Technical Cause
* **Numeral Systems:** Arabic uses Western Arabic numerals (`0-9`) in some regions/contexts, and Eastern Arabic numerals (`٠-٩`, Unicode `U+0660` through `U+0669`) in others.
* **Contextual Substitution (`locl`):** When you type ASCII digits (`0-9`), the browser might dynamically substitute them with Eastern Arabic glyphs depending on the user's OS locale, system preferences, browser configuration, or the font's locale-specific (`locl`) OpenType feature.
* **Font Defaults:** Some Arabic webfonts default to rendering standard ASCII codes (U+0030–U+0039) as Eastern Arabic numerals, while other fonts render them as Western ASCII numerals.

### (b) Concrete Fix & Tradeoffs
To achieve absolute consistency, use explicit OpenType features or Unicode normalization:

* **Option A: Explicit OpenType Control via CSS**
  If the webfont includes both glyph sets, you can force lining/Western numerals:
  ```css
  .force-western-nums {
    font-variant-numeric: lining-nums;
    font-feature-settings: "lnum" on, "locl" off;
  }
  
  .force-eastern-nums {
    font-variant-numeric: normal;
    font-feature-settings: "lnum" off, "locl" on;
  }
  ```
* **Option B: Unicode Normalization (Most Robust)**
  Convert the numerals at the data level before serving them.
  * To guarantee Western numerals: Ensure database outputs contain only characters `U+0030` to `U+0039`.
  * To guarantee Eastern numerals: Use JavaScript/backend code to map ASCII digits to the Arabic range:
    ```javascript
    const toEasternArabicNums = (numStr) => 
      numStr.replace(/\d/g, d => String.fromCharCode(d.charCodeAt(0) + 1584));
    ```
* **Tradeoffs:** Normalizing ASCII to Eastern Arabic characters (`U+0660`–`U+0669`) in the HTML structure makes it harder for users with standard English/Western keyboards to search for numbers on the page (via Cmd+F/Ctrl+F) and can break copy-paste calculations in external tools.

---

## 4. Kasra and Shadda Overlap

### (a) Technical Cause
* **Anchor Point Positioning (`GPOS`):** Combining diacritics in Arabic (like *shadda* `U+0651` and *kasra* `U+0650`) are non-spacing marks. Their placement relative to the base character and each other is governed by the OpenType `GPOS` (Glyph Positioning) table—specifically under Mark-to-Base (`mark`) and Mark-to-Mark (`mkmk`) lookups.
* **Collision:** In modern Arabic typesetting, when a shadda and a kasra are placed on the same letter, the kasra is often rendered directly under the shadda (above the base letter) rather than underneath the base letter. If the webfont has poorly constructed anchor points in its `GPOS` table, or if the browser's shaping engine fails to apply `mkmk` lookups properly, the marks collide, overlap, and render as an illegible cluster at small font sizes.

### (b) Concrete Fix & Tradeoffs
* **Ensure OpenType Mark Positioning is Enabled:**
  ```css
  .arabic-text {
    font-feature-settings: "mark" on, "mkmk" on;
    text-rendering: optimizeLegibility;
  }
  ```
* **Font Swap (The Definitive Fix):** If the font file itself has a corrupted or missing `mkmk` table, CSS cannot calculate correct offsets. The fix is to switch to a webfont known for excellent diacritic engineering, such as *Amiri* (which uses complex classical typographic rules) or *Noto Sans Arabic*.
* **Font Size Adjustments:** Keep font sizes for fully vocalized (diacritic-heavy) Arabic text larger than standard Latin text (minimum `16px`, ideally `18px`+) and increase the `line-height` (to at least `1.6` or `1.8`) to accommodate stacked markers without vertical clipping.
* **Tradeoffs:** Switching fonts can disrupt brand design guidelines. Increasing `line-height` and font size changes the layout and requires more screen real estate.

---

## 5. Ellipsis Truncation on the Wrong Side and Mid-Ligature Cuts

### (a) Technical Cause
* **Wrong-Side Ellipsis:** The browser determines where to place the ellipsis (`...`) based on the element's directionality (`direction`). If an Arabic container inherits or defaults to `direction: ltr`, the browser treats the right side as the end of the text line, rendering the ellipsis there. For RTL Arabic, this means the ellipsis appears at the *beginning* of the sentence.
* **Mid-Ligature Dangling Stroke:** Arabic letters change shape depending on their connectivity. If a word is truncated mid-word (either via hard string splitting or browser text-overflow), the browser's shaper treats the remaining boundary character as an initial or medial letter, leaving its connection stroke (the tail intended to connect to the next letter) dangling in mid-air.

### (b) Concrete Fix & Tradeoffs
* **Ensure Right-to-Left (RTL) Layout and Isolating Contexts:**
  Set the `dir` attribute in HTML and configure CSS for proper text truncation:
  ```html
  <h1 dir="rtl" class="headline">نص عربي طويل جداً سيتم اقتطاعه...</h1>
  ```
  ```css
  .headline {
    direction: rtl;
    unicode-bidi: isolate;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ```
* **Preventing Dangling Joins (CSS Line Clamping):** Use `-webkit-line-clamp` combined with `word-break: keep-all` and `overflow-wrap: normal`. This forces the browser to truncate at word boundaries (whitespace) rather than character or ligature boundaries, avoiding the dangling stroke completely.
  ```css
  .headline-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 1; /* Limits to one line */
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: keep-all; /* Prevents splitting words */
  }
  ```
* **Tradeoffs:** Restricting truncation to word boundaries (`word-break: keep-all`) means that a very long word might overflow or cause early truncation if it cannot fit in the container, but it preserves grammatical and calligraphic integrity.

---

## 6. Synthesized Faux Bold

### (a) Technical Cause
* **Font Synthesis:** When CSS demands `font-weight: 700` (or `bold`), but the loaded webfont family only contains the Regular (`400`) weight, the browser's graphics rendering engine synthesizes a bold face.
* **Outline Smearing:** It does this by taking the regular glyph vectors and duplicating them with a slight horizontal offset or applying a vector stroke outline.
* **Degradation of Arabic Letterforms:** Arabic calligraphy relies heavily on precise stroke contrast (thick vertical strokes and thin horizontal curves, loops, and counters). Faux bold clogs small interior loops (like in `م`, `و`, `ص`), overlaps stacked diacritics, distorts the baseline, and destroys the aesthetic and legibility of the script.

### (b) Concrete Fix & Tradeoffs
* **Disable Font Synthesis via CSS:**
  Force the browser to render the font at its actual weight rather than simulating bold:
  ```css
  .arabic-text {
    font-synthesize: none; /* Disables synthetic bold, italic, and small-caps */
    /* Alternatively, target weight specifically: */
    font-synthesize: weight;
  }
  ```
* **Load the True Bold Weight in `@font-face`:**
  Ensure the actual bold font asset is downloaded and defined correctly:
  ```css
  @font-face {
    font-family: 'Cairo';
    src: url('/fonts/cairo-regular.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'Cairo';
    src: url('/fonts/cairo-bold.woff2') format('woff2');
    font-weight: 700;
    font-style: normal;
  }
  ```
* **Tradeoffs:** Disabling font synthesis without loading a bold font asset means bold text will simply render as regular weight (400), causing a loss of visual hierarchy. Loading an additional bold webfont file (`woff2`) adds weight to the page load budget, which slightly increases loading latency. However, for Arabic script, this is a necessary performance tradeoff to maintain legibility.
