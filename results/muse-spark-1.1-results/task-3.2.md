# Arabic Typography - 6 Problems: Causes & Fixes

## 1. الله ligature inconsistency

**Why:**
- `الله` can be rendered as a single presentation ligature vs. sequence ل ا م ل ه.
- Some fonts contain a special glyph for الله via OpenType GSUB: `liga`, `dlig`, `rlig`, `calt`, or `ccmp`. Others don't.
- Also Unicode has U+FDF2 ﷲ ARABIC LIGATURE ALLAH ISOLATED FORM. If user content contains FDF2, fonts that have that codepoint show special glyph; fonts that don't fall back to sequence.
- With a font-stack like `font-family: "Custom", system-ui`, Custom may have ligature, fallback Arabic font may not, causing inconsistency per word depending on fallback.
- Browser shaping engines (HarfBuzz, CoreText, DirectWrite) apply `rlig` by default, but behavior varies if `font-variant-ligatures` or `font-feature-settings` disabled.

**Fix:**
- Decide one canonical visual and enforce same webfont for all Arabic range.
- Normalize text: `text = text.normalize('NFKC')` maps U+FDF2 -> ا ل ل ه sequence. Or reverse: replace sequence with FDF2 if you want ligature always. Store ASCII.
- Define `@font-face` with `unicode-range: U+0600-06FF, U+0700-08FF, U+FDF0-FDFF, U+FE70-FEFF` so same file covers both forms.
- Explicitly control features:

```css
/* force ligature everywhere */
.ar {
  font-family: "IBM Plex Sans Arabic", "Amiri", sans-serif;
  font-variant-ligatures: contextual common-ligatures;
  font-feature-settings: "rlig" 1, "liga" 1, "dlig" 1;
}
/* force decomposed everywhere */
.ar-no-allah-lig {
  font-feature-settings: "liga" 0, "dlig" 0, "rlig" 0;
}
```
- Tradeoff: Disabling is disrespectful typographically; forcing requires shipping a font that actually has a good Allah glyph. Best is ship one high-quality font and keep ligature on.

---

## 2. letter-spacing shatters Arabic

**Why:**
- Arabic is cursive: letters have 4 forms (isolated, initial, medial, final) selected by `init`, `medi`, `fina`, `rlig`, `calt` GSUB.
- CSS `letter-spacing` inserts extra advance between characters *after* shaping in most implementations. This breaks joining: bidi shaper sees non-zero tracking and forces isolated/final forms or inserts gap, so connections disappear, showing disconnected letters with gaps.
- Spec says letter-spacing should not break joining but browsers historically do.

**Fix:**
- Never apply `letter-spacing` to Arabic. Reset for RTL/ar lang:

```css
.headline-luxury {
  letter-spacing: 0.08em;
}
.headline-luxury:lang(ar),
[dir="rtl"] .headline-luxury,
.headline-luxury[lang="ar"] {
  letter-spacing: 0 !important;
}
```

- Replace luxury cue with Arabic-appropriate cues:
```css
:lang(ar).headline-luxury {
  word-spacing: 0.06em;
  line-height: 1.3;
  font-size: 1.05em;
  font-variation-settings: "wdth" 110; /* if variable font */
}
```
- Tradeoff: You lose tracking luxury. There's no safe non-zero letter-spacing for connected Arabic; even 0.02em will break. Only `word-spacing` is safe.

---

## 3. 0123 vs ٠١٢٣ depending on device

**Why:**
- Three encodings: ASCII digits U+0030-0039 (0-9), Arabic-Indic U+0660-0669 (٠-٩), Extended Arabic-Indic U+06F0-06F9 (Persian).
- Some Arabic fonts have `locl` (localized forms) for `lang="ar"` that substitutes 0-9 -> ٠-٩ via OpenType. When page has `lang="ar"` or `<html lang="ar">`, HarfBuzz enables `locl` for Arabic and font renders Arabic-Indic even though underlying chars are ASCII.
- Other devices/browsers don't apply `locl`, or font lacks it, or user typed actual Arabic-Indic codepoints from Arabic keyboard. Result: same string looks different per OS/font/locale.
- Also Intl: `font-language-override`, and iOS Arabic system font automatically uses Arabic-Indic.

**Fix:**
- Decide policy per locale: e.g., GCC prefers ٠١٢٣? Maghreb/North Africa prefers 0123. Document it.
- Normalize storage to ASCII digits: on input
```js
text.replace(/[\u0660-\u0669]/g, c => c.charCodeAt(0)-0x0660)
    .replace(/[\u06F0-\u06F9]/g, c => c.charCodeAt(0)-0x06F0)
```
- Force European digits via CSS:

```css
.force-latin-digits {
  font-variant-numeric: lining-nums;
  font-feature-settings: "locl" 0;
  font-language-override: normal;
}
```

Or HTML: `lang="ar-u-nu-latn"` -> numbering system latin.

- Force Arabic-Indic:

```css
.force-arabic-indic {
  font-feature-settings: "locl" 1;
  font-language-override: "ARA";
}
/* also */
html[lang="ar"] { font-language-override: "ARA"; }
```

Best practice:

```html
<span dir="ltr" lang="en-u-nu-latn">123</span> inside Arabic sentence
```

And set `unicode-bidi: isolate` to avoid reordering.

- Tradeoff: Forcing one form can be culturally incorrect; allow user setting.

---

## 4. kasra + shadda overlap

**Why:**
- Harakat: shadda U+0651 above, kasra U+0650 normally below (or below shadda combined). Positioning needs GPOS tables `mark` and `mkmk` with anchors for base->mark and mark->mark stacking.
- Cheap or aggressively subsetted webfonts have missing or bad anchors for shadda+kasra combination. Shaper tries to stack but anchors collide, marks overlap.
- Wrong mark order: canonical order should be shadda then kasra: U+0651 U+0650. If input is U+0650 U+0651, some shapers don't reorder, GPOS lookup fails.
- At small size, ascender/descender space insufficient, line-height clips.

**Fix:**
- Use quality font tested for Quranic/text: Amiri, Noto Naskh Arabic, IBM Plex Sans Arabic, Scheherazade New. Ensure subsetting preserves GPOS: use `pyftsubset --layout-features='*'` not dropping `mark,mkmk`.
- Ensure features enabled:

```css
.quran {
  font-family: "Amiri", "Noto Naskh Arabic", serif;
  font-size: 18px; /* min 16px for diacritics */
  line-height: 1.9;
  text-rendering: optimizeLegibility;
  font-feature-settings: "mark" 1, "mkmk" 1, "rlig" 1;
  -webkit-font-smoothing: antialiased;
}
```

- Normalize order in JS:

```js
function fixShaddaKasra(s){
  return s.replace(/\u0650\u0651/g, '\u0651\u0650'); // correct order
}
str = fixShaddaKasra(str.normalize('NFC'));
```

- Increase size at small breakpoints, avoid `font-size < 14px` for vocalized text. Use `font-optical-sizing: auto`.

If font still fails, it's font bug -> replace font.

---

## 5. Ellipsis on wrong side + dangling connection stroke

**Why:**
- `text-overflow: ellipsis` placement depends on `direction` and `writing-mode`. If container is `direction:ltr` or no dir, ellipsis always on right (inline-end for LTR), but Arabic RTL expects ellipsis on left.
- Second: CSS truncation cuts at codepoint count, not grapheme/word, before shaping final display. Arabic word is connected cursive. Cutting mid-word leaves medial form glyph with extending tail/kashida that expects to connect to next letter, now dangling in space next to "...".
- Also lam-alif ligature `لا` may be split.
- `white-space:nowrap` without `dir=rtl` also forces LTR paragraph level.

**Fix:**

```css
.arabic-headline.truncate {
  direction: rtl; /* critical */
  unicode-bidi: plaintext; /* or isolate */
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
```

HTML:
```html
<h2 class="arabic-headline truncate" dir="rtl" lang="ar">نص طويل...</h2>
```
For auto detection: `dir="auto"`.

- Avoid mid-word cut: truncate at word boundary.

CSS modern multi-line with logical:

```css
.clamp-2 {
  direction: rtl;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

Better for Arabic: use JS word-boundary truncation + fade, not ellipsis:

```js
const seg = new Intl.Segmenter('ar', {granularity: 'word'});
function truncateArWord(text, max){
  if(text.length<=max) return text;
  let out='', len=0;
  for(const {segment} of seg.segment(text)){
    if(len+segment.length>max) break;
    out+=segment; len+=segment.length;
  }
  return out.trimEnd() + '…';
}
```

- Tradeoff: Word-boundary truncation is shorter and needs JS. Alternative visual without dangling: use mask fade instead of ellipsis:

```css
.fade-rtl {
  direction: rtl;
  mask-image: linear-gradient(to right, black 70%, transparent 100%);
}
```

---

## 6. Fake bold (synthesized 700) destroying forms

**Why:**
- Webfont only ships 400. When CSS asks `font-weight:700`, browser's font-synthesis algorithm strokes outline by fixed offset (auto bold). Arabic stroke contrast is based on qalam angle, not uniform; synthetic thickening fills counters, merges dots, closes loop of ه, ص, makes shadda unreadable, breaks Naskh balance.
- Enabled by default: `font-synthesis: weight style`.

**Fix:**
- Ship real bold. Provide both weights under same family name:

```css
@font-face {
  font-family: "Noto Naskh Arabic";
  src: url("NotoNaskhArabic-Regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Noto Naskh Arabic";
  src: url("NotoNaskhArabic-Bold.woff2") format("woff2");
  font-weight: 700;
  font-display: swap;
}
/* variable alternative */
@font-face {
  font-family: "Noto Naskh Arabic";
  src: url("NotoNaskhArabic-VF.woff2") format("woff2");
  font-weight: 400 700;
}
```

- Disable synthesis globally:

```css
html {
  font-synthesis: none;
  font-synthesis-weight: none;
  font-synthesis-style: none;
}
.ar {
  font-synthesis: none;
}
```

Now if bold not loaded, browser shows 400 rather than ugly fake.

- Design alternative if bold weight unavailable: don't use weight for emphasis in Arabic; use size, color, background, or different face (Cairo, Tajawal):

```css
.ar-strong:lang(ar) {
  font-weight: 400;
  font-size: 1.1em;
  color: var(--ink-strong);
}
```

- Tradeoff: Disabling synthesis means bold may appear missing until you load weight; but that's preferable to destroyed letterforms.
