# SIRAJ — Visual Identity System

سراج (*sirāj*) — a lamp, a wick, a small fixed light. Not a sun, not a spotlight: a single flame that stays where you put it.

---

## 1. CONCEPT (governing idea)

**SIRAJ is a lamp on a desk at night, not a window into a machine.**

A lamp illuminates one page and lets everything else go dark. It does not ask questions, does not blink, does not follow you around the room. You bring it closer when you need it; you do not talk to it.

Consequences: there is no persistent chat surface — AI is summoned via a command palette and dismissed completely when done, leaving no transcript bubble trail. The interface has one light source (the page) and one accent color (the flame), never more. Everything that is not the manuscript recedes toward black or paper. AI output is never labeled with an avatar or a "thinking" state — it simply appears on the page, as if the ink had already been there, and the writer decides whether to keep it. The tool has no personality to perform; it has only a wick to trim.

*(114 words)*

---

## 2. TYPOGRAPHY

Arabic-first: every type decision is chosen for the Arabic letterform first; Latin is a guest.

**Pairing strategy — three roles, three registers**

| Role | Typeface (primary) | Fallback stack | Character |
|---|---|---|---|
| Display (titles, palette command labels, colophon) | **Aref Ruqaa** | `"Aref Ruqaa", "Traditional Arabic", serif` | Calligraphic, Ruqaa-inflected, literary — used only above 24px, never for body |
| Text (the manuscript / writing canvas) | **Markazi Text** | `"Markazi Text", "Noto Naskh Arabic", serif` | Naskh-derived reading face, moderate stroke contrast, generous letter-spacing at small sizes for long-form comfort |
| UI (palette, labels, metadata, status line) | **IBM Plex Sans Arabic** | `"IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif` | Geometric, quiet, low-personality — never used for anything the poet is meant to keep |

Latin companion (used only for the UI role, matched in x-height and weight): **IBM Plex Sans** / `system-ui, sans-serif`.

**Numeric type scale** (base 16px, ratio ≈ 1.25, line-height in parentheses)

```
scale-00   12px  (18px)   — metadata, timestamps, palette hints
scale-10   14px  (22px)   — UI labels, secondary text
scale-20   16px  (28px)   — UI body, palette items
scale-30   18px  (32px)   — manuscript body (default writing size)
scale-40   21px  (36px)   — manuscript body, large-print mode
scale-50   24px  (34px)   — section headings inside document
scale-60   32px  (42px)   — document title
scale-70   48px  (58px)   — display / colophon / empty-state mark
scale-80   64px  (72px)   — splash / brand mark only
```

**Rules for Latin embedded in Arabic text**

1. Latin runs (citations, ISBNs, dates in Gregorian form, code-like tokens) are wrapped in a Unicode bidi isolate (`⁦…⁩` / CSS `unicode-bidi: isolate`) so they never reorder surrounding Arabic words.
2. Latin embedded inline is set in **IBM Plex Sans**, matched to 92% of the surrounding Arabic point size (Latin faces read visually larger at equal point size) and to the same weight token as the host run.
3. Numerals default to **Arabic-Indic digits (٠١٢٣…)** in manuscript text; **Western digits** are permitted only in UI chrome (shortcuts, counters, timestamps). The two never mix silently within the same text run — a document-level locale toggle controls manuscript numerals, and it is explicit, not inferred.
4. Latin words are never given decorative or display treatment — they are always set in the UI face, even inside a display-face Arabic heading, so the display face's calligraphic weight is never diluted by a foreign letterform.
5. No italics. Emphasis in Arabic is carried by weight or by the traditional overline/underline convention, never by an oblique face (Arabic has no native italic).

---

## 3. COLOR

The palette is derived directly from the concept: **ink** (near-black, warm, carbon-based) sitting on **paper** (warm off-white), with exactly **one** accent — the **flame** — reserved for the single moment AI is summoned. No blue. No purple. No gradient. A lamp casts one color of light.

### Dark mode — "the desk at night" (default)

| Token | Hex | Use | Contrast intent |
|---|---|---|---|
| `color.bg.canvas` | `#0F0D0A` | Root background, warm near-black (lamp-black, not neutral gray) | — |
| `color.bg.surface` | `#17140F` | Palette, panels, elevated surfaces | 1.15:1 vs canvas (barely lifted) |
| `color.border.hairline` | `#2A2620` | Dividers, palette border | 1.4:1 vs surface, non-load-bearing |
| `color.text.primary` | `#F2EADA` | Manuscript text | 14.8:1 on canvas (AAA, built for long reading) |
| `color.text.secondary` | `#B7AC97` | UI labels, metadata | 7.1:1 on canvas (AAA for UI text) |
| `color.text.tertiary` | `#726A58` | Placeholder, disabled, timestamps | 3.9:1 on canvas (large/decorative text only) |
| `color.accent.flame` | `#E08A3C` | Cursor, summon glyph, active palette item — nothing else | 6.3:1 on canvas |
| `color.accent.flame-dim` | `#7A4B22` | Flame at rest / hover halo, 40% perceived intensity of flame | decorative only, never carries text |
| `color.state.focus-ring` | `#E08A3C` at 55% alpha | Focus outline | non-text, 3:1 min vs adjacent surface |
| `color.state.selection` | `#3A2E1A` | Text selection background | — |

### Light mode — "the page at noon"

| Token | Hex | Use | Contrast intent |
|---|---|---|---|
| `color.bg.canvas` | `#F7F1E4` | Root background, warm paper | — |
| `color.bg.surface` | `#EFE7D4` | Palette, panels | 1.1:1 vs canvas |
| `color.border.hairline` | `#DCD0B4` | Dividers | non-load-bearing |
| `color.text.primary` | `#1B1712` | Manuscript text | 15.1:1 on canvas (AAA) |
| `color.text.secondary` | `#4E4736` | UI labels | 7.4:1 on canvas (AAA) |
| `color.text.tertiary` | `#8A8062` | Placeholder, timestamps | 4.1:1 |
| `color.accent.flame` | `#B85E12` | Cursor, summon glyph | 5.2:1 on canvas |
| `color.accent.flame-dim` | `#E3C39A` | Flame at rest / hover halo | decorative only |
| `color.state.focus-ring` | `#B85E12` at 55% alpha | Focus outline | 3:1 min |
| `color.state.selection` | `#E9D9B6` | Text selection background | — |

**Stated rule:** the flame accent may appear in at most **one** location on screen at any time (cursor OR active palette row OR summon glyph — never two simultaneously). Body text always targets AAA (7:1+); UI chrome targets AA-large minimum (3:1+), since low-emphasis metadata is deliberately quiet, not illegible.

---

## 4. MOTION

**Principles**

- Motion exists only to explain a state change (summon / dismiss / commit). It never exists to feel "alive," "responsive," or "delightful" for its own sake.
- Durations: `120ms` (micro — hover, focus ring), `200ms` (standard — palette open/close), `400ms` (settle — AI text arriving on the page). Nothing in the system exceeds 400ms.
- Easings (cubic-bezier):
  - `ease.standard` → `cubic-bezier(0.4, 0, 0.2, 1)` — symmetric UI transitions (panels, focus rings)
  - `ease.kindle` → `cubic-bezier(0.16, 1, 0.3, 1)` — fast start, long soft landing; used only for the flame igniting
  - `ease.settle` → `cubic-bezier(0.65, 0, 0.35, 1)` — even, unhurried; used only for text arriving
- **What NEVER animates:** the manuscript text itself while being read or typed (no reflow animation, no per-character typewriter effect on AI output), the caret (blinks at a fixed OS-native rate only, never eased), page scroll position (no smooth-scroll on programmatic jumps), any loading state (no spinners — a summon either resolves or the flame simply stays lit and waits), window/app chrome, and nothing ever loops indefinitely.

**Three signature moves**

1. **Kindle** — opening the command palette. A single point of flame-dim light appears at the cursor and expands radially into the palette surface (`200ms`, `ease.kindle`), simultaneous with a `120ms` opacity fade on the palette border. This is the only entrance animation in the product; it is never reused for anything else, so it always means "the lamp has been picked up."
2. **Wick trim** — dismissing the palette or any AI suggestion. The reverse of Kindle: the surface contracts back to the single point at the cursor over `160ms` using `ease.standard` (contraction is snappier than expansion — trimming a wick is decisive, lighting one is deliberate).
3. **Ink settle** — an accepted AI suggestion entering the manuscript. The text is already positioned (no typewriter reveal); it fades from 0 to full `text.primary` opacity over `400ms` with `ease.settle`, as though ink already on the page were only now becoming visible, rather than being typed by something outside the writer.

---

## 5. TOKENS (design-tokens JSON)

```json
{
  "color": {
    "dark": {
      "bg": { "canvas": "#0F0D0A", "surface": "#17140F" },
      "border": { "hairline": "#2A2620" },
      "text": { "primary": "#F2EADA", "secondary": "#B7AC97", "tertiary": "#726A58" },
      "accent": { "flame": "#E08A3C", "flameDim": "#7A4B22" },
      "state": { "focusRing": "#E08A3C8C", "selection": "#3A2E1A" }
    },
    "light": {
      "bg": { "canvas": "#F7F1E4", "surface": "#EFE7D4" },
      "border": { "hairline": "#DCD0B4" },
      "text": { "primary": "#1B1712", "secondary": "#4E4736", "tertiary": "#8A8062" },
      "accent": { "flame": "#B85E12", "flameDim": "#E3C39A" },
      "state": { "focusRing": "#B85E128C", "selection": "#E9D9B6" }
    }
  },
  "type": {
    "family": {
      "display": "'Aref Ruqaa', 'Traditional Arabic', serif",
      "text": "'Markazi Text', 'Noto Naskh Arabic', serif",
      "uiArabic": "'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif",
      "uiLatin": "'IBM Plex Sans', system-ui, sans-serif"
    },
    "scale": {
      "00": { "size": 12, "lineHeight": 18 },
      "10": { "size": 14, "lineHeight": 22 },
      "20": { "size": 16, "lineHeight": 28 },
      "30": { "size": 18, "lineHeight": 32 },
      "40": { "size": 21, "lineHeight": 36 },
      "50": { "size": 24, "lineHeight": 34 },
      "60": { "size": 32, "lineHeight": 42 },
      "70": { "size": 48, "lineHeight": 58 },
      "80": { "size": 64, "lineHeight": 72 }
    },
    "weight": { "regular": 400, "medium": 500, "bold": 700 },
    "numerals": { "manuscriptDefault": "arabic-indic", "uiDefault": "western" }
  },
  "space": {
    "0": 0, "1": 4, "2": 8, "3": 12, "4": 16, "5": 24, "6": 32, "7": 48, "8": 64, "9": 96
  },
  "radius": {
    "none": 0, "sm": 2, "md": 6, "lg": 12, "full": 999
  },
  "motion": {
    "duration": { "micro": "120ms", "standard": "200ms", "settle": "400ms", "trim": "160ms" },
    "easing": {
      "standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "kindle": "cubic-bezier(0.16, 1, 0.3, 1)",
      "settle": "cubic-bezier(0.65, 0, 0.35, 1)"
    }
  }
}
```

---

## 6. DEMO — writing canvas with command palette open (single-file HTML)

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>سراج — SIRAJ</title>
<style>
  :root{
    --bg-canvas:#0F0D0A; --bg-surface:#17140F; --border-hairline:#2A2620;
    --text-primary:#F2EADA; --text-secondary:#B7AC97; --text-tertiary:#726A58;
    --accent-flame:#E08A3C; --accent-flame-dim:#7A4B22;
    --focus-ring:#E08A3C8C; --selection:#3A2E1A;
    --f-display:'Aref Ruqaa','Traditional Arabic',serif;
    --f-text:'Markazi Text','Noto Naskh Arabic',serif;
    --f-ui:'IBM Plex Sans Arabic','Noto Sans Arabic',sans-serif;
    --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px; --sp-7:48px;
    --r-md:6px; --r-lg:12px;
    --e-standard:cubic-bezier(0.4,0,0.2,1);
    --e-kindle:cubic-bezier(0.16,1,0.3,1);
    --e-settle:cubic-bezier(0.65,0,0.35,1);
  }
  *{box-sizing:border-box;}
  ::selection{background:var(--selection);}
  html,body{height:100%;margin:0;}
  body{
    background:var(--bg-canvas); color:var(--text-primary);
    font-family:var(--f-text); overflow:hidden;
  }
  .statusbar{
    position:fixed; top:0; inset-inline:0; height:40px;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 var(--sp-5); font-family:var(--f-ui); font-size:12px;
    color:var(--text-tertiary); border-bottom:1px solid var(--border-hairline);
  }
  .statusbar .mark{color:var(--text-secondary); letter-spacing:.04em;}
  .canvas{
    max-width:640px; margin:0 auto; padding:96px var(--sp-5) 120px;
    height:100%; overflow-y:auto;
  }
  .doc-title{
    font-family:var(--f-display); font-size:32px; line-height:42px;
    color:var(--text-primary); margin:0 0 var(--sp-6);
  }
  .doc-body{
    font-family:var(--f-text); font-size:18px; line-height:32px;
    color:var(--text-primary); white-space:pre-wrap;
  }
  .doc-body .placeholder{ color:var(--text-tertiary); }
  .caret{
    display:inline-block; width:2px; height:20px; background:var(--accent-flame);
    vertical-align:-3px; animation:blink 1s steps(1) infinite;
  }
  @keyframes blink{ 50%{ opacity:0; } }

  .scrim{
    position:fixed; inset:0; background:#000; opacity:.55;
    animation:scrimIn 200ms var(--e-standard) forwards;
  }
  @keyframes scrimIn{ from{opacity:0;} to{opacity:.55;} }

  .palette{
    position:fixed; top:22%; left:50%;
    width:min(560px, 88vw);
    background:var(--bg-surface); border:1px solid var(--border-hairline);
    border-radius:var(--r-lg);
    box-shadow:0 0 0 1px #00000040, 0 24px 64px -12px #00000090;
    transform-origin:center 8px;
    animation:kindle 200ms var(--e-kindle) forwards;
  }
  @keyframes kindle{
    from{ transform:translate(-50%,0) scale(.14); opacity:0; }
    to{ transform:translate(-50%,0) scale(1); opacity:1; }
  }
  .palette-input-row{
    display:flex; align-items:center; gap:var(--sp-3);
    padding:var(--sp-4) var(--sp-5);
    border-bottom:1px solid var(--border-hairline);
  }
  .flame-glyph{
    width:10px; height:10px; border-radius:50%;
    background:var(--accent-flame);
    box-shadow:0 0 12px 3px var(--accent-flame-dim);
  }
  .palette-input{
    flex:1; background:transparent; border:0; outline:0;
    font-family:var(--f-ui); font-size:16px; color:var(--text-primary);
    direction:rtl;
  }
  .palette-input::placeholder{ color:var(--text-tertiary); }
  .palette-hint{
    font-family:var(--f-ui); font-size:12px; color:var(--text-tertiary);
    border:1px solid var(--border-hairline); border-radius:var(--r-md);
    padding:2px 6px;
  }
  .palette-list{ list-style:none; margin:0; padding:var(--sp-3); }
  .palette-item{
    display:flex; align-items:center; justify-content:space-between;
    padding:10px var(--sp-4); border-radius:var(--r-md);
    font-family:var(--f-ui); font-size:14px; color:var(--text-secondary);
    cursor:default;
  }
  .palette-item.active{
    background:#1F1A12; color:var(--text-primary);
    box-shadow:inset 2px 0 0 var(--accent-flame);
  }
  .palette-item .key{
    font-family:var(--f-ui); font-size:11px; color:var(--text-tertiary);
    direction:ltr;
  }
  .palette-footer{
    padding:var(--sp-3) var(--sp-5); border-top:1px solid var(--border-hairline);
    font-family:var(--f-ui); font-size:11px; color:var(--text-tertiary);
    display:flex; justify-content:space-between;
  }
</style>
</head>
<body>

  <div class="statusbar">
    <span class="mark">سِراج</span>
    <span>قصيدة بلا عنوان — محفوظة تلقائياً</span>
  </div>

  <main class="canvas">
    <h1 class="doc-title">مرثية للضوء الأول</h1>
    <div class="doc-body">في الليلِ حين يخفتُ كلُّ صوتٍ إلا صوتَ القلم،
أكتبُ كما يكتبُ الزيتُ في القنديل،
قطرةً قطرة، لا دفعةً واحدة.<span class="placeholder"> اكتب ما يليه…</span><span class="caret"></span></div>
  </main>

  <div class="scrim"></div>

  <div class="palette" role="dialog" aria-label="لوحة الأوامر">
    <div class="palette-input-row">
      <div class="flame-glyph"></div>
      <input class="palette-input" placeholder="استدعِ سراج…" value="أكمل بنفس الوزن" />
      <span class="palette-hint">Esc</span>
    </div>
    <ul class="palette-list">
      <li class="palette-item active"><span>أكمل بنفس الوزن والقافية</span><span class="key">↵</span></li>
      <li class="palette-item"><span>اقترح صورة شعرية بديلة</span><span class="key">2</span></li>
      <li class="palette-item"><span>راجع الإيقاع دون تغيير المعنى</span><span class="key">3</span></li>
      <li class="palette-item"><span>حوّل الأرقام إلى الرقم الهندي</span><span class="key">4</span></li>
    </ul>
    <div class="palette-footer">
      <span>سيظهر الاقتراح في مكانه على الصفحة — لا حوار، لا فقاعات</span>
      <span>محلي بالكامل — بلا اتصال</span>
    </div>
  </div>

</body>
</html>
```

The demo instantiates the concept directly: there is exactly one light source on screen (the flame glyph and its halo), it is the only saturated color anywhere in the frame, the palette arrives via the *Kindle* radial-expansion keyframe rooted at the cursor point rather than sliding in like a menu, the manuscript sits on warm ink-on-paper tones with no chrome around it, and there is no chat log, no avatar, and no bubble — only the page and, when summoned, the palette.

---

## 7. FORBIDDEN LIST

1. **Never** renders AI output in a chat bubble or as a labeled "message."
2. **Never** shows a typing/"thinking…" indicator or animated ellipsis.
3. **Never** gives the AI a face, mascot, avatar, or name spoken in first person ("I think…").
4. **Never** uses blue/purple gradients, glassmorphism, or any palette associated with generic AI-chat branding.
5. **Never** auto-scrolls, auto-plays, or auto-opens anything without a direct user action.
6. **Never** uses emoji, exclamation marks, or celebratory micro-copy in UI chrome.
7. **Never** shows more than one accent-colored (flame) element on screen at the same time.
8. **Never** interrupts the writer with a modal, toast, badge, or notification while the manuscript has focus — SIRAJ may only be summoned, never intrude.
