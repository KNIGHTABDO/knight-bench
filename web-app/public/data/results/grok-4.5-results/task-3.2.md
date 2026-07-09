# Arabic Typography Problems: Technical Causes and Concrete Fixes

## 1. "الله" as a special single glyph vs. separate letters

### (a) Why it happens technically

Many Arabic fonts implement **Allah ligature / special presentation forms** for the sequence الله (alif–lam–lam–ha, often with optional diacritics). In OpenType, this is typically driven by:

- **GSUB** (Glyph Substitution) features such as `rlig` (required ligatures), `liga`, or vendor-specific lookups that replace the four-character sequence with a single **decorative / calligraphic Allah glyph** (sometimes with a shadda–dagger-alif composition baked in).
- Some fonts also map via **Arabic Presentation Forms** or custom private-use / stylistic sets.
- Fonts that **lack** that lookup (or disable ligatures) fall back to the normal joining chain: isolated/medial/final forms of ل and ه connected by cursive joining rules (`init`/`medi`/`fina`/`isol` via Arabic shaping / HarfBuzz / Uniscribe / Core Text).

So the **same Unicode string** `U+0627 U+0644 U+0644 U+0647` can render as:

- one precomposed calligraphic mark (visual consistency only *within* fonts that ship that glyph), or  
- four shaped glyphs with normal lam–lam–ha joining.

That is **font-dependent OpenType behavior**, not a different string. Mixing fonts (system UI font vs. webfont, fallback chain mid-string, different weights) produces inconsistent Allah rendering across the app.

Related gotchas:

- Some fonts only form the special form when **shadda + superscript alif** (or similar) are present; bare الله may not trigger it.
- `font-variant-ligatures: none` / `font-feature-settings: "liga" 0, "rlig" 0` can **suppress** required/discretionary ligatures and break the special form (or, conversely, force the multi-glyph path).
- Partial fallback: if the primary webfont lacks the ligature but a fallback has it (or the reverse), you get mixed behavior.

### (b) Concrete CSS/HTML/font fix

**Goal: one intentional rendering across the product.**

1. **Pick one behavior and enforce it with a single webfont family** that you control for all Arabic UI (and user content if possible). Do not rely on system fallbacks for sacred/brand-critical words.

```css
:root {
  --font-ar: "YourArabicFont", "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif;
}
html[lang="ar"],
[dir="rtl"],
.ar {
  font-family: var(--font-ar);
}
```

2. **If you want the special single-glyph Allah** (common in religious or traditional UI):
   - Choose a font whose `rlig`/`liga` (or documented Allah feature) includes it (e.g. many traditional Naskh/Kufi faces; check with FontDrop / `hb-shape` / browser DevTools font features).
   - Keep ligatures on:

```css
.arabic-body {
  font-variant-ligatures: common-ligatures;
  /* rlig is usually on by default for Arabic; do not disable: */
  font-feature-settings: "liga" 1, "rlig" 1;
}
```

3. **If you want consistent *separate* shaped letters** (modern UI, brand uniformity without calligraphic Allah):
   - Prefer a **UI/sans** face that **does not** substitute a special Allah glyph (e.g. many geometric Arabic sans designs), **or**
   - Explicitly turn off discretionary ligatures if the special form is discretionary (test carefully—**disabling `rlig` can harm required Arabic joining** and is often a bad idea):

```css
/* TRADEOFF: may only work if Allah is implemented as discretionary liga, not rlig.
   Never blanket-disable rlig on all Arabic text without testing joining. */
.headline-no-allah-ligature {
  font-variant-ligatures: no-common-ligatures;
  font-feature-settings: "liga" 0;
}
```

4. **Hard consistency for a known string** (rare, content-controlled cases):
   - Use a **dedicated class + font** only for that token, or
   - Use an **SVG / icon** for a branded Allah mark if marketing demands a fixed drawing (HTML text remains for accessibility: visually hidden live text + `aria-hidden` decorative SVG, or vice versa carefully).
   - Avoid inserting Presentation Form code points manually; prefer logical Arabic letters + shaping.

5. **Audit the stack**: same `font-family`, same weight/style axis, same `font-feature-settings` on all surfaces (web, embedded WebView, email if applicable). Subset webfonts carefully so the ligature glyphs are not stripped by a bad subsetter.

**Tradeoff:** Forcing ligatures off for consistency can reduce calligraphic authenticity; forcing a traditional Naskh for Allah alone can clash with a modern UI sans elsewhere—prefer one product-wide Arabic face strategy.

---

## 2. Letter-spacing on a “luxury” headline shatters Arabic into disconnected letters

### (a) Why it happens technically

Arabic is a **cursive joining script**. Adjacent letters share **connection strokes** determined by:

- Unicode Arabic joining types (dual-joining, right-joining, etc.),
- the shaper selecting **initial / medial / final / isolated** glyphs,
- OpenType **mark positioning** and often **cursive attachment** (`curs` feature) so exit/entry anchors align.

CSS `letter-spacing` (and `tracking` in design tools) adds **extra advance width between *clusters/glyphs***. For Latin this only widens gaps between independent letters. For Arabic it:

- **Pulls joining forms apart** so the outbound stroke of glyph *n* no longer meets the inbound stroke of glyph *n+1*,
- Leaves **floating connection tails**, broken words, and unreadable “scattered” letterforms,
- Can also interact badly with **lam-alif ligatures**, **kashida**-like elongation, and mark attachment.

So “luxury tracking” is a **Latin-centric pattern** that is actively harmful for Arabic (and often for other complex scripts).

### (b) Concrete CSS/HTML/font fix

1. **Never apply positive `letter-spacing` to Arabic text.**

```css
.headline {
  letter-spacing: 0.12em; /* Latin luxury look */
}

/* Reset for Arabic / RTL content */
:lang(ar) .headline,
[dir="rtl"] .headline,
.headline:lang(ar) {
  letter-spacing: normal; /* or 0 */
}
```

2. **Scope luxury tracking to Latin-only spans** when mixed:

```html
<h1 class="headline">
  <span class="track-latin" lang="en">LUXURY</span>
  <span lang="ar">عنوان فاخر</span>
</h1>
```

```css
.track-latin {
  letter-spacing: 0.15em;
}
```

3. **Arabic “luxury” alternatives** (that preserve joining):

| Approach | How |
|----------|-----|
| Larger size / weight | `font-size`, true bold/black weight |
| Optical size / display cut | Use a **display** Arabic master if available |
| Color / gradient / gold stroke | `background-clip: text`, borders, shadows (carefully) |
| Extra line height / padding | `line-height`, `padding-inline` |
| Controlled elongation | Traditional **kashida** / tatweel `ـ` (U+0640) between joinable letters—**manual or smart**, not `letter-spacing` |
| Tracking-like openness | Choose a **wider Arabic face** or `font-stretch` if the variable font supports a width axis **designed** for Arabic |

```css
.headline-ar {
  letter-spacing: normal;
  font-family: "DisplayArabic", serif;
  font-weight: 600;
  font-size: clamp(1.75rem, 4vw, 3rem);
  line-height: 1.4;
  /* optional: slight word spacing is safer than letter-spacing, still use sparingly */
  word-spacing: 0.05em;
}
```

4. **Design-token rule:** in your design system, set `letter-spacing` tokens to `0` under `script: Arabic` / `lang: ar`.

**Tradeoff:** You will not get Latin-style spaced-out capitals in Arabic without breaking the script. Wider fonts or tatweel are the authentic substitutes; overusing tatweel looks unnatural if inserted naively (e.g. after non-joining letters).

---

## 3. Numbers appear as ٠١٢٣ on some devices and 0123 on others

### (a) Why it happens technically

There are **two Unicode blocks** commonly involved:

- **European digits:** U+0030–U+0039 (`0`–`9`) — “ASCII” / Western Arabic numerals in common UI parlance  
- **Arabic-Indic digits:** U+0660–U+0669 (`٠`–`٩`) — used widely in Arabic locales  
- (Also **Eastern Arabic-Indic / Persian** U+06F0–U+06F9 `۰`–`۹` in fa/ur contexts)

What the user *sees* depends on a pipeline:

1. **What characters are in the string** (content may already be Arabic-Indic or European).
2. **Locale-aware formatting** (`Intl.NumberFormat`, OS locale, `toLocaleString`).
3. **Bidi and digit substitution** at the platform/font/shaper level:
   - Historically, some systems applied **national digit shaping** based on locale (Windows, some Android versions, browser/OS combinations).
   - OpenType **`locl`** (localized forms) or font-specific digit sets can remap European digit code points to Arabic-Indic **glyphs** in Arabic locales—or not.
4. **Browser + OS + font** differences: Chrome/Firefox/Safari, Windows vs. macOS vs. Android, and whether the webfont embeds Arabic-Indic digit glyphs all affect the outcome.
5. HTML/CSS: `lang` on the element influences **default locale for shaping and form controls**; missing `lang="ar"` yields inconsistent behavior vs. a fully Arabic locale environment.

So the same logical number `2024` can render as `٢٠٢٤` or `2024` depending on **stored code points**, **locale**, and **font `locl`/digit features**—not pure “randomness,” but **environment-dependent digit shaping and content encoding**.

### (b) Concrete CSS/HTML/font fix

**Decide a product policy** (examples: always European digits in UI chrome; Arabic-Indic in body copy for ar-SA; follow user locale).

#### Fix A — Force European digits (common for dashboards, codes, mixed product UI)

1. **Store and emit ASCII digits** in the DOM (`0`-`9`), not Arabic-Indic code points.  
2. **Locale for formatting:** use a locale that does not substitute digits, or use `numberingSystem: 'latn'`:

```js
new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(1234);
// "1234" with Arabic locale conventions for separators if any, Latin digits
```

3. **CSS (where supported)** to prefer Latin digits:

```css
.force-latn-nums {
  font-variant-numeric: lining-nums; /* limited effect on Arabic-Indic */
  font-feature-settings: "tnum" 0;   /* optional tabular/lining — font-dependent */
  /* Modern intent for numbering systems (support varies): */
  font-variant-numeric: normal;
}
```

More reliable than CSS alone is **`lang` + explicit numbering system in formatters**. Some engines respect:

```html
<html lang="ar">
```

combined with Unicode **locale extension** in formatting (`ar-u-nu-latn`) rather than CSS.

```js
n.toLocaleString("ar-u-nu-latn");
```

4. Ensure the webfont includes **European digit glyphs** so fallback fonts do not swap appearance.

#### Fix B — Force Arabic-Indic digits (٠١٢٣)

1. Format with Arabic-Indic numbering system:

```js
new Intl.NumberFormat("ar-SA", { numberingSystem: "arab" }).format(2024);
// "٢٠٢٤"
```

or `ar-u-nu-arab`.

2. Or normalize strings to U+0660–U+0669 if you control the content pipeline.  
3. Pick a font that actually draws Arabic-Indic digits well at your sizes.

#### Fix C — Follow user preference / device locale

- Format with the user’s locale (`navigator.language`) and **document that numbers will vary**.  
- Still set `<html lang="ar" dir="rtl">` correctly so bidi of mixed number+Arabic is correct (`dir`, isolate with `bdi` / `unicode-bidi: isolate` around numbers when needed).

```html
<p lang="ar" dir="rtl">
  السعر هو
  <bdi>128.50</bdi>
  ر.س
</p>
```

**Also set:**

```html
<html lang="ar" dir="rtl">
```

and keep **one formatting helper** for the whole app so React/Vue components do not mix raw concatenation with `Intl` inconsistently.

**Tradeoff:**

- Forcing Latin digits improves **cross-device visual QA** and engineering consistency but may feel foreign to users in regions that expect ٠–٩.  
- Forcing Arabic-Indic improves local authenticity but confuses mixed EN/AR product codes, IDs, and copy-paste into Latin systems.  
- CSS alone **cannot fully replace** correct Unicode digits + `Intl` numberingSystem; treat CSS as secondary.

---

## 4. Kasra and shadda overlap on the same letter (unreadable at small sizes)

### (a) Why it happens technically

Arabic diacritics (**tashkil**) are **non-spacing combining marks** (e.g. shadda U+0651, kasra U+0650, fatha U+064E, damma U+064F). Correct stacking requires:

1. **OpenType GPOS** (Glyph Positioning): mark-to-base (`mark`) and mark-to-mark (`mkmk`) anchors so multiple marks on one base letter stack without collision.  
2. Correct **mark order** in the string (canonical order / normalization; Arabic mark ordering conventions).  
3. Adequate **em-box vertical space** and outline design for small ppem sizes.

When a webfont has:

- missing or incorrect **`mkmk`** anchors for shadda+kasra (kasra should sit **below** the base; shadda **above**—but combinations like shadda+kasra have defined positions and some fonts mishandle vertical offsets),
- a **poorly hinted** or unhinted outline at 12–14px,
- overly tight vertical metrics,

…the marks **collide or fuse** visually. At small sizes, even *correct* GPOS can fail due to **pixel rounding**, sparse stem spacing, and aggressive webfont subsetting that drops mark positioning data.

Note: shadda + vowel is a very common pair; quality Naskh/text fonts handle it; many free or auto-generated UI fonts do not.

### (b) Concrete CSS/HTML/font fix

1. **Primary fix: use a text face with proven mark positioning**  
   Prefer production-grade fonts tested with full tashkil (e.g. **Noto Naskh Arabic**, **Amiri**, **Scheherazade New**, or a commercial UI Arabic with documented diacritic support). Avoid display/decorative faces for vocalized text.

2. **Load the font with features that keep marks** — do not subset out mark glyphs or GPOS tables. If using `glyphhanger` / `pyftsubset`, preserve Arabic marks and OpenType layout tables (`GSUB`/`GPOS`).

3. **Do not use CSS “hacks” as the main fix** for collision (letter-spacing, fake transforms on marks). Fix the font.

4. **Size and weight for vocalized text:**

```css
.vocalized-ar {
  font-family: "Noto Naskh Arabic", "Amiri", serif;
  font-size: 1.125rem; /* avoid 11–12px for fully vocalized copy */
  line-height: 1.8;    /* extra lead for marks above/below */
  font-weight: 400;    /* synthetic bold worsens mark alignment — see #6 */
  font-kerning: normal;
  font-feature-settings: "mark" 1, "mkmk" 1, "ccmp" 1;
  /* These are usually on by default; the point is: don't disable them */
}
```

5. **Optional: variable font optical size** (`opsz`) if available—display opsz at small sizes is worse for marks.

6. **Content hygiene:** normalize Unicode (NFC is usually fine for Arabic; be careful with custom normalizers that reorder marks incorrectly). Prefer correct logical order: base + shadda + vowel as produced by standard input methods.

7. **If you must stay on a weak UI sans:**  
   - strip optional tashkil in UI chrome where meaning allows, **or**  
   - render vocalized educational/Quranic strings in a **second font family** reserved for tashkil:

```css
.ui-ar { font-family: "UI Sans Arabic", sans-serif; }
.tashkil-ar {
  font-family: "Noto Naskh Arabic", serif;
  font-size: 1.125em;
  line-height: 2;
}
```

**Tradeoff:** Naskh text fonts read more “book-like” than geometric UI sans; dual-font systems need careful rhythm matching. Increasing `font-size` / `line-height` costs density. **There is no pure-CSS substitute for missing `mkmk` anchors.**

---

## 5. Ellipsis truncation on the wrong side; mid-ligature cut leaves a dangling connection stroke

### (a) Why it happens technically

Two separate mechanisms stack:

#### Wrong side for the ellipsis

- CSS `text-overflow: ellipsis` with `overflow: hidden; white-space: nowrap` truncates in the **inline progression direction** as implemented by the browser’s line box logic.  
- For **RTL** (`direction: rtl` / `dir="rtl"`), the inline start is on the **right**; overflow should typically clip toward the **inline end** (left in pure RTL) and place ellipsis accordingly.  
- If the element (or an ancestor) is still **`direction: ltr`**, or the string is **bidirectionally mixed** without isolation, the browser’s bidi reordering can make the **visual** ellipsis appear on the left or right incorrectly relative to reading order.  
- Flex/grid items without correct `dir`, `text-align`, or `min-width: 0` also produce “ellipsis on the wrong side” bugs.

#### Mid-ligature / mid-joining cut

- Truncation is usually based on **layout width / cluster boundaries**, but implementations may still clip **mid-glyph** or after a **medial joining form** that expected a following letter.  
- The last visible Arabic letter may keep a **medial or initial form** (connection stroke on the left/right) because shaping ran on the **full string** or on a **substring that still includes a joiner context** incorrectly—or conversely the visual clip cuts through a **ligature** (e.g. lam-alif) or a continuous stroke.  
- Result: a **dangling connection tail**, half-ligature, or orphan stroke—especially with `nowrap` + ellipsis, or when JS slices strings by JS string index (UTF-16 code units) without respecting **grapheme clusters** or Arabic joining groups.

So: **bidi/direction bugs** → ellipsis side; **shaping + visual clip + non-cluster-aware truncation** → broken joins.

### (b) Concrete CSS/HTML/font fix

1. **Correct direction and language on the truncating element:**

```html
<h2 class="truncate-ar" lang="ar" dir="rtl">
  عنوان طويل جداً يحتاج إلى اختصار بشكل صحيح
</h2>
```

```css
.truncate-ar {
  direction: rtl;
  text-align: start; /* physical right in RTL */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  /* In flex children: */
  min-width: 0;
  max-width: 100%;
}
```

2. **Prefer logical properties** so LTR/RTL layouts stay correct:

```css
.card-title {
  padding-inline: 1rem;
  margin-inline-start: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

3. **Isolate mixed content** so numbers/Latin do not scramble ellipsis side:

```html
<span dir="rtl" lang="ar" class="truncate-ar">
  طلب <bdi>#18432</bdi> — تفاصيل المستخدم الطويلة
</span>
```

4. **Multi-line clamp** (still needs correct `dir`):

```css
.truncate-ar-2 {
  direction: rtl;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  /* text-overflow ellipsis behavior with line-clamp is engine-specific */
}
```

5. **Reduce mid-join “dangling stroke” artifacts:**

| Technique | Detail |
|-----------|--------|
| Truncate on **word / phrase** boundaries when you control the string | Prefer CSS overflow over blind `substring(0, n)` |
| If JS truncate is required | Use **grapheme-aware** segmentation (`Intl.Segmenter` with `granularity: "grapheme"`) and, better, **word** segmentation; avoid cutting between a base and its marks |
| Avoid shaping-then-clip disasters | Prefer **layout truncation** (CSS) over pre-shaping a shortened string when possible |
| Optional soft break opportunities | Insert zero-width spaces only with extreme care—can break joining if placed between dual-joining letters |
| Use fonts with clearer finals | Some UI fonts’ medial forms look more “dangling” when clipped |

Example of safer JS truncation (still not perfect for joining forms):

```js
function truncateGraphemes(str, max) {
  const seg = new Intl.Segmenter("ar", { granularity: "grapheme" });
  const chars = [...seg.segment(str)].map(s => s.segment);
  if (chars.length <= max) return str;
  return chars.slice(0, max).join("") + "…";
}
```

For Arabic joining quality, **prefer CSS `text-overflow`** so the engine clips the already-shaped line; if dangling medials still appear, it is often an **engine limitation**—mitigate with **slightly more width**, **shorter copy**, or **fade mask** instead of ellipsis:

```css
/* Tradeoff: fade avoids a false final form + ellipsis side debates */
.fade-truncate-ar {
  direction: rtl;
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to left, transparent 0, #000 2.5rem);
  /* "to left" because visual end of RTL line is on the left */
}
```

6. **Do not use** `text-align: left` hard-coded on Arabic headlines; use `start`/`end`.

**Tradeoff:** Fade masks are more “designy” and less obvious as truncation for accessibility—pair with full text in `title` / tooltip / expandable UI. JS grapheme truncation can still leave a medial **joining form** because Arabic shaping is not “letter = independent glyph.” **Perfect mid-word Arabic truncation without dangling joins is inherently hard**; product-level avoidance (shorter titles, two-line clamp) is often the best fix.

---

## 6. Fake bold (`font-weight: 700`) destroys Arabic letterforms

### (a) Why it happens technically

If the `@font-face` for your Arabic family only registers **weight 400** (regular) but CSS asks for **700**, the browser may apply **synthetic bold** (emboldening / Faux Bold):

- Algorithmically **thickens strokes** (outline dilation or double-draw),
- Does **not** use a real bold master’s redesigned proportions,
- Destroys **counter sizes**, **dental spacing** (س ص ش teeth), **dot (i‘jam) separation**, **kaf / lam** terminals, and **GPOS mark anchors** (marks no longer sit on the thickened base correctly),
- Arabic is especially fragile because stems are dense and **dots/marks sit in tight gaps**.

This is the same class of problem as faux italic, but bold synthesis is more common when a single-file webfont is linked without weight variants.

### (b) Concrete CSS/HTML/font fix

1. **Ship real bold (and medium/semibold if needed)** as separate files or a variable font axis:

```css
@font-face {
  font-family: "AppArabic";
  src: url("/fonts/AppArabic-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}

@font-face {
  font-family: "AppArabic";
  src: url("/fonts/AppArabic-Bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}
```

Variable font:

```css
@font-face {
  font-family: "AppArabic";
  src: url("/fonts/AppArabic-VF.woff2") format("woff2");
  font-weight: 100 900; /* enable real weight axis */
  font-style: normal;
}
```

2. **Turn off synthetic bold** so missing weights fail closed (use real weight or regular) instead of mangling glyphs:

```css
.ar, :lang(ar) {
  font-synthesis: none;
  /* or more narrowly: */
  font-synthesis-weight: none;
  font-synthesis-style: none;
}
```

3. **Map design weights to real faces** in the type ramp:

```css
.ar-strong {
  font-family: "AppArabic", sans-serif;
  font-weight: 700; /* only if 700 @font-face exists */
}

/* If you only have 400 and 600: */
b, strong, .bold {
  font-weight: 600; /* match an actual master */
}
```

4. **Audit computed styles:** DevTools → check that bold text’s **Rendered face** is `AppArabic Bold` / weight 700 file, not `AppArabic` + synthetic.

5. **Avoid** `text-shadow` stacking or `filter: drop-shadow` as a “bold” substitute for body text; acceptable only as a limited decorative effect.

**Tradeoff:** More font files = more bytes (mitigate with `woff2`, subsetting, `unicode-range`, and only weights you use). `font-synthesis: none` means if someone requests 700 without a face, text stays regular—**better readable than faux bold**, but hierarchy weakens until you add a real bold. **Never rely on synthetic bold for Arabic.**

---

## Cross-cutting recommendations (all six issues)

1. **Always set** `lang="ar"` and `dir="rtl"` (or logical CSS + `dir` on the root / subtree).  
2. **One primary Arabic webfont strategy** with explicit weights, tested OpenType features (`rlig`, `liga`, `mark`, `mkmk`, `locl`, digits).  
3. **Script-aware design tokens:** `letter-spacing: 0` for Arabic; separate number policy via `Intl` `numberingSystem`.  
4. **QA matrix:** Safari iOS, Chrome Android, Chrome Windows, macOS—digit shaping and ellipsis/bidi differ.  
5. **Validate with real strings:** الله, fully vocalized words (شَدَّة + كَسْرَة), long RTL headlines, mixed `طلب #123`, and `font-weight: 700`.  
6. **Prefer layout engines’ shaping** over home-grown string hacks; when you must slice text, use `Intl.Segmenter` and accept joining limitations.

---

### Quick reference

| # | Problem | Root cause | Primary fix |
|---|---------|------------|-------------|
| 1 | الله ligature inconsistency | Font GSUB ligature vs. normal joining | One webfont + explicit liga/rlig policy |
| 2 | Tracking shatters letters | `letter-spacing` breaks cursive joins | `letter-spacing: normal` on Arabic; use weight/size/width/tatweel |
| 3 | ٠١٢٣ vs 0123 | Code points + locale + `locl`/numbering system | `Intl` `numberingSystem` + consistent storage + `lang` |
| 4 | Kasra/shadda collision | Bad/missing GPOS `mark`/`mkmk`; small size | Quality text font; larger size/line-height; preserve GPOS |
| 5 | Ellipsis side + dangling join | Wrong `dir`/bidi; clip mid-join | `dir="rtl"` + ellipsis; avoid naive JS cuts; optional fade |
| 6 | Faux bold damage | Only 400 shipped; browser synthesis | Real 700/VF axis + `font-synthesis: none` |
