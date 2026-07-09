# Arabic Typography Review: Causes and Fixes

## 1. `الله` renders as a special single glyph in some fonts but as separate letters in others

### Why it happens technically

The word `الله` is often handled by Arabic fonts through a discretionary or required ligature/substitution rule in the font's OpenType layout tables, usually in GSUB features such as `rlig`, `liga`, or font-specific Arabic shaping rules. Some fonts contain a dedicated Allah ligature glyph and substitute the sequence of letters `ا` + `ل` + `ل` + `ه` into that single glyph. Other fonts do not include that glyph or do not expose the substitution in the same way, so the text is shaped as normal connected Arabic letters.

The browser does not decide this by semantic meaning alone. It passes the Unicode characters to the shaping engine, and the final result depends on the font's glyph inventory and OpenType feature implementation. If fallback fonts are involved, the same word may even render differently in different parts of the app depending on which font actually covers the characters.

There is also a Unicode compatibility character, U+FDF2 `ﷲ` ARABIC LIGATURE ALLAH ISOLATED FORM. Using that character hard-codes the ligature as text. That can make rendering more consistent visually, but it is usually a content-level tradeoff because it affects search, normalization, copy/paste, indexing, accessibility, and font fallback behavior.

### Concrete fix

Use one Arabic-capable font consistently across the app and make sure all text resolves to that same font before fallback. For example:

```css
:root {
  font-family: "Noto Naskh Arabic", "Amiri", "Arial", sans-serif;
}

[lang="ar"],
.arabic {
  font-family: "Noto Naskh Arabic", "Amiri", "Arial", sans-serif;
}
```

If the desired visual policy is to always show the special Allah ligature, choose and ship a font that contains and enables that ligature, then avoid fallback splitting by using a complete Arabic font subset. If the desired policy is to avoid the special ligature and keep normal letter shaping, choose a font that does not substitute `الله` into a single Allah glyph, or disable standard ligatures only if the font exposes the substitution through a feature that can actually be disabled:

```css
.arabic-no-decorative-ligatures {
  font-variant-ligatures: no-common-ligatures;
  font-feature-settings: "liga" 0;
}
```

That fix is a tradeoff. Disabling ligature features globally can harm Arabic typography because Arabic shaping relies on OpenType behavior. Do not disable `rlig`, `calt`, `ccmp`, `init`, `medi`, `fina`, or `isol`; those are essential for correct Arabic shaping in many fonts. A safer fix is font selection and consistent font loading, not broad feature suppression.

Avoid replacing normal text with U+FDF2 unless the product intentionally wants that compatibility glyph. Prefer storing the normal Unicode sequence `الله` in content and controlling appearance through font choice.

---

## 2. `letter-spacing` was added for a luxury headline style and Arabic text shattered into disconnected letters

### Why it happens technically

Arabic is a cursive script. Adjacent letters connect through contextual joining forms selected by the text shaping engine. CSS `letter-spacing` inserts extra advance between shaped characters or glyph clusters. In many browser/font combinations, applying positive tracking to Arabic disrupts the visual connection between letters because the joining strokes no longer meet. The text may still be technically shaped, but the added spacing makes connected forms appear broken; in some cases shaping can also degrade around combining marks or ligatures.

This is different from Latin uppercase tracking, where adding spacing between independent letters is often acceptable. Arabic letters are not independent visual blocks in normal text.

### Concrete fix

Do not use positive `letter-spacing` on Arabic text. Reset it for Arabic language runs:

```css
.headline {
  letter-spacing: 0.08em;
}

.headline:lang(ar),
[lang="ar"] .headline {
  letter-spacing: normal;
}
```

If the same component can contain mixed languages, mark Arabic content with `lang="ar"` so the override applies correctly:

```html
<h1 class="headline" lang="ar">عنوان عربي فاخر</h1>
```

For an Arabic luxury headline style, use alternatives that preserve joining:

```css
.headline:lang(ar) {
  letter-spacing: normal;
  font-family: "Noto Kufi Arabic", "Noto Naskh Arabic", sans-serif;
  font-weight: 600;
  line-height: 1.25;
}
```

Better visual controls include choosing a display Arabic typeface, increasing `font-size`, adjusting `line-height`, using weight contrast, using color and whitespace, or using Kashida/tatweel only with expert typographic control. Do not simulate tracking by inserting spaces or U+0640 tatweel blindly; that changes text content and can produce poor justification, bad search behavior, and awkward shaping.

---

## 3. Numbers inside Arabic sentences sometimes appear as `٠١٢٣` and sometimes as `0123` depending on the user's device

### Why it happens technically

The characters `0 1 2 3` and `٠ ١ ٢ ٣` are different Unicode code points. ASCII/European digits are U+0030 through U+0039. Arabic-Indic digits are U+0660 through U+0669. Extended Arabic-Indic digits, used for Persian and Urdu, are U+06F0 through U+06F9.

If the app stores ASCII digits but relies on font, locale, browser, operating system, or input method behavior to display localized numerals, output can vary. Some fonts include localized digit substitution through OpenType `locl` or numeric features. Some platforms or frameworks may format numbers according to locale. Other devices simply render the literal digits present in the DOM. As a result, the same numeric value may appear as Arabic-Indic digits on one device and European digits on another.

CSS alone is not a reliable cross-browser way to convert ASCII digits to Arabic-Indic digits. Fonts can provide localized forms, but support and defaults vary.

### Concrete fix

Decide the product policy first: either store/render the exact digit characters you want, or format numbers explicitly by locale before inserting them into the DOM.

For Arabic-Indic digits:

```js
const formatted = new Intl.NumberFormat("ar-EG", {
  numberingSystem: "arab"
}).format(123); // ١٢٣
```

For European/Latin digits inside Arabic UI:

```js
const formatted = new Intl.NumberFormat("ar", {
  numberingSystem: "latn"
}).format(123); // 123
```

Then render the result normally:

```html
<p lang="ar" dir="rtl">رقم الطلب: <span>١٢٣</span></p>
```

or:

```html
<p lang="ar" dir="rtl">رقم الطلب: <span>123</span></p>
```

Use `lang` and `dir` to give the browser correct bidi and language context:

```html
<html lang="ar" dir="rtl">
```

If numbers are identifiers such as order IDs, phone numbers, SKUs, or codes, European digits may be preferable for consistency and interoperability. If they are natural-language quantities in an Arabic locale, Arabic-Indic digits may be preferable. The important fix is to format intentionally with `Intl.NumberFormat` or server-side locale formatting, not to rely on each user's font/platform defaults.

---

## 4. Kasra and shadda diacritics overlap in the chosen webfont and become unreadable at small sizes

### Why it happens technically

Arabic diacritics are combining marks. A base letter can carry multiple marks, such as shadda plus kasra. Correct rendering depends on the font's mark positioning tables, especially OpenType GPOS features like `mark` and `mkmk`.

`mark` positions combining marks relative to base glyph anchors. `mkmk` positions one mark relative to another mark. If the font lacks good anchors, has incomplete `mkmk` support, or has poor hinting at small sizes, stacked marks can collide. The browser may be shaping the text correctly, but the font does not provide enough positioning information for readable stacked diacritics.

Small CSS sizes worsen the issue because mark shapes and anchor offsets become visually compressed. Low-resolution rendering, synthetic bold, and aggressive line-height can also make the collision look worse.

### Concrete fix

Use an Arabic font with high-quality Quranic/diacritic support and proper GPOS `mark` and `mkmk` behavior. Test the exact combinations used in the app, especially shadda + kasra, shadda + fatha, tanween, sukun, and Quranic marks.

Example CSS:

```css
.arabic-diacritics {
  font-family: "Amiri", "Noto Naskh Arabic", "Scheherazade New", serif;
  font-feature-settings: "mark" 1, "mkmk" 1, "ccmp" 1;
  line-height: 1.6;
}
```

In most modern browsers, `mark` and `mkmk` are enabled automatically for Arabic when the font supports them, but explicitly setting them can document the requirement. The real fix is still a better font, not a CSS trick.

For small UI labels, increase size and line height:

```css
.arabic-small-with-marks {
  font-size: 16px;
  line-height: 1.7;
}
```

If the text does not require full vocalization for comprehension, consider removing optional diacritics in dense UI contexts and reserving fully vocalized text for content areas with enough size and spacing. That is a content/design tradeoff: removing marks improves legibility in small UI but may change meaning or reduce religious, educational, or linguistic precision.

Do not fix mark collisions by manually inserting spaces, line breaks, or separate spans between the base letter and combining marks. That breaks Unicode text integrity and usually makes shaping worse.

---

## 5. Arabic headline truncation with ellipsis shows the ellipsis on the wrong side and cuts a connected word mid-ligature

### Why it happens technically

Arabic text is right-to-left, but CSS truncation is often implemented with a left-to-right assumption:

```css
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
```

The side where the ellipsis appears depends on the element's bidi direction and inline formatting context. If the element is missing `dir="rtl"` or has inherited `direction: ltr`, the ellipsis can appear on the visually wrong side for Arabic. Mixed Arabic and Latin text can make this more confusing if the browser has to infer direction from content.

The second problem is more fundamental: `text-overflow: ellipsis` clips visually at the box edge. It does not understand Arabic word boundaries, joining behavior, or ligature aesthetics. It can cut through a connected word or shaped glyph run, leaving a partial joining stroke. The browser is clipping painted glyphs, not re-typesetting the string into a beautiful Arabic abbreviation.

### Concrete fix

Set explicit language and direction on Arabic truncation containers:

```html
<h2 class="truncate" lang="ar" dir="rtl">عنوان عربي طويل جدا يحتاج إلى اختصار</h2>
```

```css
.truncate:lang(ar) {
  direction: rtl;
  unicode-bidi: plaintext;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

`unicode-bidi: plaintext` is useful when the element contains user-generated mixed-direction text because each paragraph's base direction is resolved from its own content. For a known Arabic UI string, `dir="rtl"` is usually enough.

For a single-line Arabic title where the ellipsis should indicate removed text at the visual left edge, `dir="rtl"` with `text-overflow: ellipsis` is usually the correct baseline.

However, this does not fully solve mid-word or mid-ligature clipping. CSS ellipsis is a tradeoff. Better fixes are:

Use line wrapping instead of truncation when the title is important:

```css
.arabic-title {
  white-space: normal;
  overflow-wrap: normal;
  line-height: 1.35;
}
```

Use multi-line clamping to reduce harsh single-line clipping:

```css
.arabic-title-clamp {
  direction: rtl;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.35;
}
```

Or truncate at word boundaries in application code before rendering:

```js
const segmenter = new Intl.Segmenter("ar", { granularity: "word" });
const words = [...segmenter.segment(title)].filter(part => part.isWordLike);
const shortened = words.slice(0, 8).map(part => part.segment).join(" ") + "…";
```

Application-level word truncation is more typographically respectful, but it is also a tradeoff: it requires locale-aware logic, may not perfectly preserve punctuation/spacing unless implemented carefully, and can produce different lengths than CSS box-based truncation. For user content, always keep the full text available via expansion, accessible name, or a detail view.

---

## 6. Browser-synthesized `font-weight: 700` fake bold destroys Arabic letterforms

### Why it happens technically

If a CSS rule requests `font-weight: 700` but the loaded Arabic webfont only provides a 400 face, the browser may synthesize bold by algorithmically emboldening the glyph outlines. This is called faux bold or synthetic bold.

Arabic letterforms are especially sensitive to this because strokes, counters, dots, joining strokes, and diacritics need carefully balanced spacing. Fake bold thickens shapes without the font designer's spacing, anchor, and mark-positioning adjustments. It can close counters, merge dots, distort joins, and make diacritics collide. It may also interact badly with fallback fonts if only some glyphs are emboldened.

### Concrete fix

Ship real Arabic font files for every weight you use, and declare them explicitly with `@font-face`:

```css
@font-face {
  font-family: "AppArabic";
  src: url("/fonts/AppArabic-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "AppArabic";
  src: url("/fonts/AppArabic-Bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

[lang="ar"] {
  font-family: "AppArabic", "Noto Naskh Arabic", sans-serif;
}
```

If using a variable font, expose the supported weight range accurately:

```css
@font-face {
  font-family: "AppArabicVariable";
  src: url("/fonts/AppArabic[wght].woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
```

Then request only weights that the font really supports:

```css
strong,
.bold {
  font-weight: 700;
}
```

If the app cannot ship a real bold Arabic face, avoid requesting 700 for Arabic and use a supported weight plus other emphasis:

```css
[lang="ar"] strong {
  font-weight: 400;
  color: #111;
}
```

or choose a semibold/medium face if available:

```css
[lang="ar"] strong {
  font-weight: 600;
}
```

You can also disable synthetic bold where supported:

```css
[lang="ar"] {
  font-synthesis-weight: none;
}
```

or the broader shorthand:

```css
[lang="ar"] {
  font-synthesis: none;
}
```

That is a tradeoff: disabling synthesis prevents ugly fake bold, but if no real bold face is available, the text will not become visually bold. The correct production fix is to load a real Arabic bold or variable font weight and keep `font-weight` values aligned with the actual font files.
