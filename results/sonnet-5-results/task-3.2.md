# Arabic Typography Problems: Technical Causes and Fixes

## 1. "الله" (Allah) renders as a special ligature glyph in some fonts, separate letters in others

**(a) Why it happens technically:**
The word "الله" is a candidate for a specific Unicode/OpenType feature: many Arabic fonts include a dedicated "lam-lam-heh" ligature (sometimes encoded via the `rlig` (required ligatures) or `liga` OpenType feature table, and in some cases fonts include the pre-composed presentation form U+FDF2 ARABIC LIGATURE ALLAH ISOLATED FORM). Whether this ligature fires depends entirely on:
- Whether the font's GSUB table defines that specific ligature substitution.
- Whether the browser/rendering engine has the relevant OpenType feature (`rlig`, `liga`, or sometimes `calt`) enabled by default.
- Whether the text is typed as plain characters (ا-ل-ل-ه, i.e., alef-lam-lam-heh) versus the special presentation-form code point U+FDF2.

Fonts differ in whether they ship this ligature at all — it's a design/craft decision, not a Unicode requirement — so the same underlying character sequence renders as one fused glyph in some fonts (e.g., traditional Naskh-style fonts) and as four separate connected letters in others (most modern UI/sans fonts like Noto Sans Arabic, Cairo, IBM Plex Sans Arabic typically do NOT include this special ligature, rendering it as ordinary joined letters).

**(b) Concrete fix:**
This is fundamentally a font-selection/consistency problem, not something you can force uniformly across arbitrary fonts:
- **Do not** hardcode U+FDF2 (the special Allah presentation form) in your source text/database — it's a compatibility character intended for legacy compatibility, not for original authoring, and many fonts don't map it to anything sensible (missing-glyph box) or render it inconsistently at different sizes.
- Store the word as plain Unicode letters (ا, ل, ل, ه) and let normal Arabic shaping (which is mandatory, not optional, per the Unicode Arabic Joining algorithm) render it.
- To get *consistent* behavior across your app, pick a single font (or a very small, tested font stack) for all Arabic body/UI text, and explicitly test whether that font's GSUB table includes the special ligature. If you want the fused ligature look, choose a font known to include it (many traditional Naskh/Quranic-style fonts do); if you want plain joined letters (recommended for UI consistency and legibility at small sizes), choose a font that does NOT include it (most neutral UI Arabic fonts, e.g., Noto Sans Arabic, Dubai, Cairo).
- If you need to guarantee no ligature substitution ever fires (for strict visual predictability, e.g., in data tables), you can disable ligatures with `font-variant-ligatures: none;` or via low-level control `font-feature-settings: "liga" 0, "rlig" 0;` — **tradeoff**: `rlig` is technically supposed to be "required" for correct Arabic letter joining in some implementations, so aggressively disabling all ligature features is risky; test carefully, because disabling the wrong feature can break normal letter-joining, not just the special Allah ligature. The safer, narrower control is font selection, not feature-flag suppression.

---

## 2. `letter-spacing` on a headline broke the Arabic text into disconnected letters

**(a) Why it happens technically:**
Arabic script is cursive/connected by design — adjacent letters normally join via contextual shaping (the Unicode Arabic Joining behavior: each letter has isolated, initial, medial, and final forms selected automatically based on neighboring characters, implemented through the font's GSUB contextual substitution rules). The `letter-spacing` CSS property inserts extra space *between glyph advance boxes* at the character level. This extra inter-character gap:
- Visually separates the connecting strokes even when the shaping engine still selects the "joined" glyph form, making the connection look broken/dangling, and
- In some browser/font combinations, can cause the shaping engine to bail out of contextual substitution entirely, causing letters to fall back to their **isolated forms** instead of initial/medial/final forms, since letter-spacing interferes with the assumption of a continuously flowing cursive run.

This is a known, long-standing CSS limitation: `letter-spacing` is designed for spaced (Latin-style, non-connected) scripts and is fundamentally hostile to cursive scripts (Arabic, and also breaks Mongolian, and can distort Devanagari conjuncts).

**(b) Concrete fix:**
There is no way to add real inter-letter tracking to Arabic and preserve correct joining — this is a genuine tradeoff, not a bug with a clean fix:
- **Primary fix: do not use `letter-spacing` on Arabic text at all.** Scope the luxury/headline letter-spacing style to Latin/Latin-script content only, e.g., apply it via a class that you only add for non-Arabic locales, or use `:lang()` scoping: `:lang(ar) { letter-spacing: normal !important; }` alongside your general headline rule, so Arabic overrides back to normal.
- If the design genuinely wants a "spaced-out" luxury look for Arabic, achieve visual airiness through **other** means that don't break shaping: increase `line-height`, increase `word-spacing` (which only affects the space character between words, not intra-word joining), use a font with wider natural proportions/apertures, or increase font-size/letter width via font choice — not `letter-spacing`.
- If a tiny amount of letter-spacing is unavoidable for a purely decorative one-off (e.g., a logotype), it must be manually kerned per-glyph in a design tool (not live CSS) or explicitly accepted as "isolated-forms-as-a-display-effect" — i.e., treat it as artwork, not live shaped text.

---

## 3. Numbers show as ٠١٢٣ (Arabic-Indic) on some devices and 0123 (Western/"Arabic numerals") on others

**(a) Why it happens technically:**
The digit characters most commonly typed/stored are the plain ASCII digits U+0030–U+0039 ("0"–"9"), which Unicode calls "Western digits" (often, confusingly, called "Arabic numerals" in English even though this is the international/Latin form). Separately, there are dedicated Unicode code points for Arabic-Indic digits (U+0660–U+0669, ٠١٢٣...) and Extended Arabic-Indic/Persian digits (U+06F0–U+06F9) used in Farsi/Urdu contexts.
When your source text stores plain ASCII digits (0-9), most rendering engines display them as-is — **except** that some OS-level text/number-formatting layers, some fonts, and some browser locale-aware number formatting (or `Intl.NumberFormat` with certain locales, or OS-level input method / regional settings on iOS and some Android/Arabic-locale builds) automatically substitute Western digits with Arabic-Indic digits based on the detected content locale, the `lang` attribute, the OS regional numbering system preference, or even the font's own automatic digit-shape substitution (some Arabic fonts implement OpenType locale-based digit substitution via the `locl` feature, switching digit shapes depending on the declared `lang`). This is why the *same* stored text (`0123`) renders differently on different devices: the substitution decision is being made at the OS/browser/font layer, inconsistently, rather than being an explicit choice by your app.

**(b) Concrete fix:**
Make the digit choice explicit and stop relying on implicit locale-driven substitution:
- Decide deliberately whether your app wants Western digits (0123, common in Modern Standard Arabic UI text in many Gulf/Levant apps and nearly universal in tech/finance UI) or Arabic-Indic digits (٠١٢٣, more common in Egypt/some print contexts) — this is a genuine product/locale decision, not purely technical.
- Store and serve the digits you actually want as explicit Unicode code points rather than letting the platform infer them, so output is deterministic. If you want Western digits guaranteed everywhere, explicitly disable OpenType locale-based digit substitution with `font-variant-numeric: normal;` combined with controlling `font-feature-settings` (turn off `locl`/regional substitution where the font applies it), and avoid relying on `Intl.NumberFormat(locale)` defaults for `ar` locales (pass `{ numberingSystem: 'latn' }` explicitly, e.g., `new Intl.NumberFormat('ar-SA', { numberingSystem: 'latn' })`, or conversely `numberingSystem: 'arab'` if you want Arabic-Indic guaranteed).
- Set the `lang` attribute correctly and consistently (`lang="ar"` vs a more specific `lang="ar-EG"` etc.) since some digit-substitution behaviors key off the exact language subtag, and inconsistent `lang` attributes across your templates is a common real cause of this exact device-dependent bug.
- Test explicitly on both an iOS device with Arabic regional format and a standard desktop browser, since iOS Safari is the most common source of surprise automatic Eastern-Arabic-digit substitution in date/number fields.

---

## 4. Kasra and shadda diacritics overlap on the same letter in the webfont, unreadable at small sizes

**(a) Why it happens technically:**
Arabic diacritics (harakat/tashkeel) — fatha, kasra, damma, shadda, sukun, etc. — are combining marks (Unicode `Mn`, non-spacing mark, category) that are positioned by the font's GPOS (glyph positioning) table using **mark-to-base** (`mark` feature) and **mark-to-mark** (`mkmk` feature) positioning rules. When a base letter carries two stacked diacritics simultaneously (e.g., a shadda indicating gemination combined with a kasra indicating the following short vowel — a very common real combination, e.g., in Qur'anic or fully-vocalized text), the font needs explicit mark-to-mark anchor data telling the renderer how to stack the second mark relative to the first, rather than both marks independently anchoring to the same point on the base letter. If:
- The font's `mkmk` table is missing, incomplete, or has poorly-placed anchor points for that specific letter+mark combination, or
- The font simply wasn't designed/hinted with dense vocalization in mind (many contemporary "UI" Arabic webfonts are optimized for unvocalized running text and treat full diacritics as an afterthought),

then both diacritics get positioned at (or very near) the same anchor point, causing them to visually collide/overlap, and at small pixel sizes with limited hinting this becomes an unreadable smear.

**(b) Concrete fix:**
This is a font-quality problem, not something fixable with layout CSS alone — you cannot force better mark positioning purely through CSS since positioning math lives inside the font's GPOS table:
- **Primary fix: switch to (or add as fallback) a font specifically designed for heavy diacritic/tashkeel use**, such as Amiri, Scheherazade New, Noto Naskh Arabic, or Lateef — these are built with proper `mark`/`mkmk` anchor tables for stacked diacritics, unlike many general-purpose UI sans fonts.
- If the current UI font must be kept for brand consistency, use a **two-font strategy**: the UI font for regular/unvocalized text, and a diacritic-safe font specifically for any fully-vocalized string content (apply via a CSS class/`font-family` override scoped to that content, or Unicode-range font-family fallback if the diacritic-safe font should only kick in for combining-mark ranges — note CSS `unicode-range` triggers per-character based on the *base* character present in a run, not reliably per-mark, so scoping by content-type/class is more robust than relying on `unicode-range` alone).
- Increase rendered size for any vocalized text specifically (diacritic legibility degrades disproportionately at small sizes regardless of font quality — there's a practical minimum font-size for fully-voweled Arabic, generally noticeably larger than for unvocalized body text).
- **Tradeoff:** if you must keep the current font for the whole app, there is no clean CSS-only workaround for bad `mkmk` anchors — you can only mitigate (larger size, more line-height/leading to give the diacritics vertical room, and avoiding fully-vocalized strings in that font wherever possible), not truly fix it.

---

## 5. Truncating an Arabic headline with ellipsis: ellipsis on the wrong side and mid-ligature cut

**(a) Why it happens technically:**
Two separate bugs compound here:
1. **Ellipsis on the wrong side:** CSS `text-overflow: ellipsis` places the ellipsis at the *end* of the text in logical/inline-flow order, but which visual *side* that lands on depends on the resolved `direction` of the element. If the container's `direction` is left as the default `ltr` (very common — many apps only flip `dir` on top-level containers or forget it on a specific component) while the text content is Arabic (RTL), the browser truncates and ellipsizes based on LTR inline flow, putting the ellipsis visually on the right when it should be on the left for RTL, or vice versa — it looks "wrong side" because the box's directionality doesn't match the script's natural reading direction.
2. **Cutting mid-ligature/mid-connection:** `text-overflow: ellipsis` combined with `overflow: hidden` and `white-space: nowrap` performs a purely **character-count/box-width-based** clip — it doesn't know anything about Arabic contextual shaping. It clips the underlying text at an arbitrary character boundary and *then* the renderer reshapes whatever partial run remains. If the clip lands in the middle of what should be a connected medial-form letter, the remaining fragment gets reshaped with whatever joining forms are still valid for the truncated substring — often leaving a stray connecting stroke that looks like it's pointing to a letter that's no longer there ("dangling connection"), because the shaping engine correctly draws a final-joining form for a letter that's now been cut off from its intended follower.

**(b) Concrete fix:**
- **Fix the direction mismatch first:** ensure the actual containing element has `direction: rtl;` (or better, the HTML `dir="rtl"` attribute, which also affects UA default styles, bidi algorithm behavior, and form controls more correctly than CSS `direction` alone) set on the specific headline element/container holding Arabic text — not just at the document `<html dir="rtl">` root if the app is mixed-direction/multilingual, since a single global `dir` won't correctly handle per-field mixed content. When `direction` correctly matches the script, `text-overflow: ellipsis` will place the ellipsis on the correct (leading, i.e., right-hand) side automatically.
- **Fix mid-ligature clipping — this is a real tradeoff, no perfect CSS fix exists:**
  - `text-overflow: ellipsis` is inherently a dumb character/width clip; it has no concept of grapheme or shaping-cluster boundaries in Arabic, so mid-connection cuts are always a risk on tight, arbitrary width constraints.
  - Best mitigation: truncate at the **word level** using JS/server-side logic (`Intl.Segmenter` with `granularity: 'word'`, or a locale-aware word-boundary library) rather than letting the browser clip mid-word by pixel width — truncate to the last whole word that fits, then append your own ellipsis character, so no letter is ever cut mid-shaping-cluster.
  - Alternatively, allow **multi-line clamping** instead of single-line truncation: `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;` (well-supported cross-browser now) breaks at line-wrap boundaries (which respect word boundaries) rather than clipping mid-glyph, avoiding the dangling-stroke artifact — but note `-webkit-line-clamp` still generally only handles the *last-line* ellipsis correctly for whole words, not partial shaping clusters, and the vendor-prefixed property, while broadly supported, is still technically non-standard (the `line-clamp` unprefixed CSS property is newer/less universally supported), so test target browsers.
  - If pixel-perfect single-line truncation is required, the only fully-safe approach is measuring text width in JS and truncating at grapheme-cluster boundaries (`Intl.Segmenter({ granularity: 'grapheme' })`) rather than raw string index, which avoids splitting inside a multi-codepoint cluster, combined with re-verifying the last visible letter isn't a letter whose "final form" glyph would look dangling when isolated — practically, truncating at word boundaries is the simplest robust fix.

---

## 6. `font-weight: 700` triggers faux/synthetic bold on an Arabic webfont that only ships weight 400

**(a) Why it happens technically:**
When a CSS `font-weight` value is requested that has no matching static weight (or matching axis value in a variable font) in the loaded `@font-face` font file(s), browsers fall back to **synthetic ("faux") bold**: the rendering engine takes the regular (400) glyph outlines and algorithmically thickens/emboldens them (typically by applying a stroke-expansion or skew/fatten transform to the outlines) rather than using true bold-weight-designed letterforms. This is a generic, script-agnostic fallback mechanism (the same thing happens with Latin text on incomplete font families) — the browser doesn't know or care that the font is Arabic; it applies the same crude outline-fattening algorithm.
Arabic letterforms are far more sensitive to this than Latin letterforms because Arabic relies heavily on:
- Fine, precisely-calibrated stroke contrast and thin/thick modulation for legibility and to distinguish letter forms (dots, thin connecting strokes vs. thick bowls),
- Delicate joining strokes between letters that are already thin relative to letter bodies,
so uniformly fattening every outline by a fixed amount disproportionately damages Arabic joins/counters/dot-clusters — dots merge together, joining strokes become as thick as letter bodies (destroying the visual hierarchy that makes the script legible), and counters (interior white space) can close up entirely at small sizes. This is a much more visible, more damaging effect than faux-bolding does to most Latin typefaces.

**(b) Concrete fix:**
- **Best fix: use a real bold weight.** Source and add an actual bold (700, or whatever weight is needed) static Arabic font file via a second `@font-face` rule with `font-weight: 700; src: url(...)` pointing at the true bold weight's font file, so the browser has a real weight to select instead of synthesizing one. If the type family is a variable font, ensure the `wght` axis actually covers 700 and that it's loaded/registered correctly (`font-weight: 100 900;` range in the `@font-face` block for variable fonts, matching the font's actual `fvar` axis range) — the current bug description ("only ships a 400 weight") means the family genuinely lacks bold glyph data, so this requires acquiring/licensing an actual bold weight, not just a CSS change.
- **Explicitly prevent faux bold if no real bold is available (a tradeoff, not a fix):** set `font-synthesis: none;` (or `font-synthesis-weight: none;`) in CSS. This stops the browser from faking bold — but the practical effect is simply that `font-weight: 700` renders as regular weight (no visual boldening at all), since there's no bold data to draw from. This trades "ugly/broken fake bold" for "no bold emphasis at all," which is usually the better tradeoff for Arabic legibility, but it does mean you lose the intended visual weight contrast until a real bold font asset is sourced.
- **Alternative mitigation if a true bold truly cannot be sourced:** achieve emphasis through non-weight means instead of `font-weight` — e.g., color, background highlight, size increase, or letter/word spacing adjustments scoped carefully (see problem #2 above — avoid `letter-spacing` on the Arabic run itself) — rather than triggering synthetic bold at all.
- As a verification step, confirm which weights a font family actually ships by inspecting its available static instances or variable-font `fvar` table (e.g., via a font inspection tool or the browser's font-family computed-style/network panel) before assuming `font-weight: 700` will resolve to a real glyph set — this bug is often introduced simply because a developer assumed a "normal Arabic font" package includes a full weight family the way common Latin web fonts do, when many Arabic webfonts (especially free/limited ones) ship only a single weight.
