# SIRAJ — Visual Identity System

**Product:** Local-first AI writing tool for Arabic poets and essayists  
**Positioning:** A quiet, serious instrument  
**Anti-references:** Generic AI chat apps (bubbles, avatars, neon gradients, “Ask anything…”)

---

## 1. CONCEPT (max 120 words)

**Governing idea: Marginal light.**

SIRAJ (سِرَاج) is not a conversational partner. It is a desk lamp over continuous paper. The writing surface is primary; the product is only the pool of light that makes the page legible and the few tools that live at the edge. AI never appears as a speaker in the center—it brightens, underlines, or opens a quiet command plane without claiming authorship.

**Consequences:** No chat thread. No avatar. No generative spectacle. Typography and paper dominate. Chrome is thin and peripheral. Color is paper + lamp-warmth, never brand neon. Motion is light settling, not typing theater. The command palette is a lamp door, not a chat box.

---

## 2. TYPOGRAPHY

### Arabic-first pairing strategy

| Role | Family | Role intent |
|------|--------|-------------|
| **Display (Arabic)** | **Amiri** | Literary authority for titles, poem openings, empty-state verses. High contrast, classical serifs; used sparingly. |
| **Text / body (Arabic)** | **Noto Naskh Arabic** | Long-form reading & composition. Clear naskh rhythm for essays and poems; default for the canvas. |
| **UI (Arabic + Latin chrome)** | **IBM Plex Sans Arabic** | Menus, command palette, metadata, buttons. Neutral instrument face—not calligraphic, not playful. |

*Fallback stack (CSS):*  
`"Noto Naskh Arabic", "Amiri", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif` for body; Amiri first for display; IBM Plex first for UI.

### Type scale (numeric)

Root: `16px`. Ratio ≈ **1.25** (major third), with one deliberate jump for display.

| Token | px | rem | Use |
|-------|-----|-----|-----|
| `font-size-2xs` | 11 | 0.6875 | Captions, key hints |
| `font-size-xs` | 12 | 0.75 | Meta, word count |
| `font-size-sm` | 13 | 0.8125 | Palette rows, secondary UI |
| `font-size-md` | 14 | 0.875 | UI default (chrome) |
| `font-size-base` | 16 | 1 | Dense UI labels |
| `font-size-lg` | 18 | 1.125 | Secondary canvas notes |
| `font-size-xl` | 20 | 1.25 | Body default (Arabic prose on canvas) |
| `font-size-2xl` | 24 | 1.5 | Section headings in-document |
| `font-size-3xl` | 32 | 2 | Poem titles / display |
| `font-size-4xl` | 40 | 2.5 | Rare empty-state line only |

**Line-height:** body canvas `1.85` (Arabic breathing room); UI `1.4`; display `1.35`.  
**Letter-spacing:** Arabic body `0`; UI Latin labels `0.02em` max; never track Arabic display wide.

### Weights

- Body: `400`  
- Emphasis in prose: `600` (sparingly)  
- UI labels: `500`  
- Display titles: `400` Amiri (weight via form, not bold)

### Rules for Latin embedded in Arabic text

1. **Direction:** Canvas is `dir="rtl"`. Latin runs (names, quotes, English terms) stay inline; do not flip the whole paragraph to LTR.
2. **Script switch:** Use `unicode-bidi: plaintext` on the canvas; wrap intentional LTR phrases in `<span lang="en" dir="ltr">` only when isolation is required (URLs, code-like tokens).
3. **Font:** Latin inside body text inherits **Noto Naskh Arabic** metrics where possible; if a Latin-only fallback is needed, use **Source Serif 4** or **IBM Plex Serif** at the same size—never a geometric sans mid-paragraph.
4. **Size parity:** Latin sits at the **same computed size** as surrounding Arabic; no “English smaller” habit.
5. **Case:** Prefer sentence case for English UI; all-caps only for single key glyphs (e.g. `⌘K`), never for full commands.
6. **Numerals:** Prefer Eastern Arabic numerals (`٠١٢٣…`) in literary metadata when the document locale is Arabic; Western digits allowed in technical keybindings (`Ctrl+K`).
7. **No mixed display:** Do not pair Amiri Arabic titles with a decorative Latin script; Latin subtitles use IBM Plex Sans Arabic at `font-size-sm`, muted color.

---

## 3. COLOR

Derived from **marginal light**: paper field + warm lamp pool + cool shadow beyond the pool. No “AI purple,” no electric cyan.

### Core palette (hex)

| Name | Hex | Role |
|------|-----|------|
| Paper | `#F4EFE6` | Light canvas ground |
| Paper Deep | `#E8E0D2` | Recessed paper / selection wash |
| Ink | `#1C1915` | Primary text (near-black brown) |
| Ink Soft | `#3F3A33` | Secondary text |
| Ink Faint | `#7A7268` | Tertiary / meta |
| Lamp | `#C4A574` | Warm accent (brass / filament) |
| Lamp Dim | `#8B7355` | Accent pressed / dark-mode lamp |
| Lamp Glow | `#E8D4B0` | Soft highlight / focus ring wash |
| Shadow | `#0F0E0C` | True dark ground |
| Margin | `#2A2620` | Dark chrome / elevated dark surface |
| Margin Edge | `#3D3730` | Dark borders |
| Line | `#D4CBBC` | Light hairlines |
| Line Dark | `#4A433A` | Dark hairlines |
| Danger | `#8B3A2F` | Destructive only (rare) |
| Success | `#3D5A45` | Confirm only (rare, muted) |

### Semantic tokens

**Light mode** (paper under lamp):

| Token | Value | Intent |
|-------|-------|--------|
| `color-bg-canvas` | `#F4EFE6` | Full writing field |
| `color-bg-chrome` | `#EDE6DA` | Side rails / bars |
| `color-bg-elevated` | `#FFFaf3` | Palette panel |
| `color-bg-muted` | `#E8E0D2` | Hover rows, chips |
| `color-bg-selection` | `#E8D4B0` | Text selection (~22% warm wash) |
| `color-text-primary` | `#1C1915` | Body ink |
| `color-text-secondary` | `#3F3A33` | Secondary |
| `color-text-tertiary` | `#7A7268` | Meta, placeholders |
| `color-text-inverse` | `#F4EFE6` | On dark controls |
| `color-border-subtle` | `#D4CBBC` | Dividers |
| `color-border-strong` | `#B8AD9A` | Focused panel edge |
| `color-accent` | `#8B7355` | Interactive accent |
| `color-accent-soft` | `#E8D4B0` | Focus glow, active row |
| `color-focus-ring` | `#C4A574` | Keyboard focus |
| `color-danger` | `#8B3A2F` | Delete / irreversible |

**Dark mode** (room beyond the lamp; paper becomes dim parchment under a smaller pool):

| Token | Value | Intent |
|-------|-------|--------|
| `color-bg-canvas` | `#161410` | Dim parchment field |
| `color-bg-chrome` | `#0F0E0C` | Outer chrome |
| `color-bg-elevated` | `#2A2620` | Palette / floating |
| `color-bg-muted` | `#3D3730` | Hover |
| `color-bg-selection` | `#4A3F2E` | Selection |
| `color-text-primary` | `#EDE6DA` | Readable ink-on-dark |
| `color-text-secondary` | `#B8AD9A` | Secondary |
| `color-text-tertiary` | `#7A7268` | Meta |
| `color-text-inverse` | `#1C1915` | On lamp buttons |
| `color-border-subtle` | `#3D3730` | Dividers |
| `color-border-strong` | `#5C5348` | Panel edge |
| `color-accent` | `#C4A574` | Filament |
| `color-accent-soft` | `#3D3428` | Active row wash |
| `color-focus-ring` | `#C4A574` | Focus |
| `color-danger` | `#C45C4E` | Danger (slightly lifted for contrast) |

### Ratios & contrast intent

- **Field : chrome** ≈ **85% : 15%** — canvas dominates; chrome is a thin margin.
- **Ink on paper (light):** primary text targets **≥ 12:1** against canvas (near max for comfort, not pure black).
- **Secondary text:** ≥ **4.5:1** for UI; tertiary may sit ~**3:1** for non-essential meta only.
- **Accent area:** ≤ **5%** of any screen (rules, focus, one active row)—lamp, not floodlight.
- **Borders:** hairline, low contrast (~**1.2–1.5:1** vs adjacent surface)—structure without UI noise.
- **Dark mode:** not inverted brand colors; a **smaller lamp pool** on a darker desk—accent slightly brighter, canvas cooler-brown, not blue-gray SaaS dark.

---

## 4. MOTION

### Principles

| Property | Value | Notes |
|----------|-------|-------|
| Duration micro | `90ms` | Key highlight, press |
| Duration fast | `140ms` | Hover background, border |
| Duration base | `200ms` | Palette enter, focus ring |
| Duration slow | `320ms` | Overlay dim, large fade |
| Duration glacial | `480ms` | Rare: theme crossfade only |
| Easing standard | `cubic-bezier(0.22, 1, 0.36, 1)` | Settle (light finds the page) |
| Easing exit | `cubic-bezier(0.4, 0, 1, 1)` | Quick dismiss |
| Easing linear | `cubic-bezier(0, 0, 1, 1)` | Opacity-only dim only |

**What NEVER animates**

1. **Caret / text insertion** — no typewriter effect, no AI “streaming bounce.”  
2. **Body text layout** — no reflow animation when suggestions appear.  
3. **Decorative parallax / blob backgrounds.**  
4. **Continuous loops** (spinners only if local job >300ms; then a static lamp-dot pulse at 1.2s max opacity oscillation, never a rainbow loader).  
5. **Chat-style message slide-up stacks.**  
6. **Springy overshoot** on panels (no bouncy cubic that overshoots past rest).

### Three named signature moves

1. **`lamp-open`** — Command palette: backdrop opacity 0→0.35 in `320ms` linear; panel opacity 0→1 + translateY(`-6px`→`0`) in `200ms` standard ease. Origin feels like a shutter opening above the page, not a modal slam.  
2. **`ink-settle`** — Focus ring / accent bar: opacity + scaleX from `0.96`→`1` in `140ms` standard; used when a palette row activates or canvas regains focus.  
3. **`margin-breathe`** — Soft selection or AI underline: background-color transition `200ms` standard, no movement of the text itself—light changes, letters stay.

---

## 5. TOKENS

```json
{
  "name": "SIRAJ",
  "version": "1.0.0",
  "concept": "marginal-light",
  "color": {
    "light": {
      "bg-canvas": "#F4EFE6",
      "bg-chrome": "#EDE6DA",
      "bg-elevated": "#FFFAF3",
      "bg-muted": "#E8E0D2",
      "bg-selection": "#E8D4B0",
      "bg-overlay": "rgba(28, 25, 21, 0.35)",
      "text-primary": "#1C1915",
      "text-secondary": "#3F3A33",
      "text-tertiary": "#7A7268",
      "text-inverse": "#F4EFE6",
      "border-subtle": "#D4CBBC",
      "border-strong": "#B8AD9A",
      "accent": "#8B7355",
      "accent-soft": "#E8D4B0",
      "focus-ring": "#C4A574",
      "danger": "#8B3A2F",
      "success": "#3D5A45",
      "lamp": "#C4A574",
      "ink": "#1C1915"
    },
    "dark": {
      "bg-canvas": "#161410",
      "bg-chrome": "#0F0E0C",
      "bg-elevated": "#2A2620",
      "bg-muted": "#3D3730",
      "bg-selection": "#4A3F2E",
      "bg-overlay": "rgba(0, 0, 0, 0.55)",
      "text-primary": "#EDE6DA",
      "text-secondary": "#B8AD9A",
      "text-tertiary": "#7A7268",
      "text-inverse": "#1C1915",
      "border-subtle": "#3D3730",
      "border-strong": "#5C5348",
      "accent": "#C4A574",
      "accent-soft": "#3D3428",
      "focus-ring": "#C4A574",
      "danger": "#C45C4E",
      "success": "#6A8F74",
      "lamp": "#C4A574",
      "ink": "#EDE6DA"
    }
  },
  "type": {
    "font-display": "Amiri, Noto Naskh Arabic, serif",
    "font-text": "Noto Naskh Arabic, Amiri, serif",
    "font-ui": "IBM Plex Sans Arabic, Segoe UI, Tahoma, sans-serif",
    "size-2xs": "0.6875rem",
    "size-xs": "0.75rem",
    "size-sm": "0.8125rem",
    "size-md": "0.875rem",
    "size-base": "1rem",
    "size-lg": "1.125rem",
    "size-xl": "1.25rem",
    "size-2xl": "1.5rem",
    "size-3xl": "2rem",
    "size-4xl": "2.5rem",
    "line-body": 1.85,
    "line-ui": 1.4,
    "line-display": 1.35,
    "weight-regular": 400,
    "weight-medium": 500,
    "weight-semibold": 600
  },
  "space": {
    "0": "0",
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem",
    "10": "2.5rem",
    "12": "3rem",
    "16": "4rem",
    "20": "5rem",
    "24": "6rem",
    "canvas-max": "42rem",
    "palette-width": "32rem"
  },
  "radius": {
    "none": "0",
    "sm": "2px",
    "md": "4px",
    "lg": "6px",
    "xl": "8px",
    "full": "9999px"
  },
  "motion": {
    "duration-micro": "90ms",
    "duration-fast": "140ms",
    "duration-base": "200ms",
    "duration-slow": "320ms",
    "duration-glacial": "480ms",
    "ease-standard": "cubic-bezier(0.22, 1, 0.36, 1)",
    "ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
    "ease-linear": "cubic-bezier(0, 0, 1, 1)",
    "signature": {
      "lamp-open": {
        "backdrop": "opacity 320ms cubic-bezier(0, 0, 1, 1)",
        "panel": "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 200ms cubic-bezier(0.22, 1, 0.36, 1)"
      },
      "ink-settle": {
        "focus": "opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 140ms cubic-bezier(0.22, 1, 0.36, 1)"
      },
      "margin-breathe": {
        "surface": "background-color 200ms cubic-bezier(0.22, 1, 0.36, 1)"
      }
    }
  },
  "elevation": {
    "palette": "0 8px 28px rgba(15, 14, 12, 0.12), 0 0 0 1px var(--color-border-subtle)"
  }
}
```

---

## 6. DEMO

Single-file HTML demonstration: writing canvas with command palette open. Uses only the tokens defined above (as CSS custom properties). Concept instantiated as paper field, brass lamp accent, thin chrome, RTL Arabic prose, palette as “lamp door”—not a chat.

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>سِرَاج — SIRAJ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    /* SIRAJ tokens — light (marginal light) */
    :root {
      --color-bg-canvas: #F4EFE6;
      --color-bg-chrome: #EDE6DA;
      --color-bg-elevated: #FFFAF3;
      --color-bg-muted: #E8E0D2;
      --color-bg-selection: #E8D4B0;
      --color-bg-overlay: rgba(28, 25, 21, 0.35);
      --color-text-primary: #1C1915;
      --color-text-secondary: #3F3A33;
      --color-text-tertiary: #7A7268;
      --color-text-inverse: #F4EFE6;
      --color-border-subtle: #D4CBBC;
      --color-border-strong: #B8AD9A;
      --color-accent: #8B7355;
      --color-accent-soft: #E8D4B0;
      --color-focus-ring: #C4A574;
      --color-danger: #8B3A2F;
      --color-lamp: #C4A574;
      --color-ink: #1C1915;
      --font-display: Amiri, "Noto Naskh Arabic", serif;
      --font-text: "Noto Naskh Arabic", Amiri, serif;
      --font-ui: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif;
      --size-2xs: 0.6875rem;
      --size-xs: 0.75rem;
      --size-sm: 0.8125rem;
      --size-md: 0.875rem;
      --size-xl: 1.25rem;
      --size-3xl: 2rem;
      --line-body: 1.85;
      --line-ui: 1.4;
      --line-display: 1.35;
      --weight-regular: 400;
      --weight-medium: 500;
      --space-1: 0.25rem;
      --space-2: 0.5rem;
      --space-3: 0.75rem;
      --space-4: 1rem;
      --space-5: 1.25rem;
      --space-6: 1.5rem;
      --space-8: 2rem;
      --space-12: 3rem;
      --space-16: 4rem;
      --canvas-max: 42rem;
      --palette-width: 32rem;
      --radius-sm: 2px;
      --radius-md: 4px;
      --radius-lg: 6px;
      --duration-fast: 140ms;
      --duration-base: 200ms;
      --duration-slow: 320ms;
      --ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
      --ease-linear: cubic-bezier(0, 0, 1, 1);
      --elevation-palette: 0 8px 28px rgba(15, 14, 12, 0.12), 0 0 0 1px var(--color-border-subtle);
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--font-ui);
      font-size: var(--size-md);
      font-weight: var(--weight-regular);
      line-height: var(--line-ui);
      color: var(--color-text-primary);
      background: var(--color-bg-chrome);
      -webkit-font-smoothing: antialiased;
    }
    .app {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 100%;
    }
    /* Thin chrome — margin, not product */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-6);
      background: var(--color-bg-chrome);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-family: var(--font-display);
      font-size: var(--size-xl);
      color: var(--color-ink);
      letter-spacing: 0;
    }
    .brand-mark {
      width: 10px; height: 10px;
      border-radius: var(--radius-full);
      background: var(--color-lamp);
      box-shadow: 0 0 0 3px var(--color-accent-soft);
    }
    .top-meta {
      font-size: var(--size-xs);
      color: var(--color-text-tertiary);
      font-weight: var(--weight-medium);
    }
    .top-meta kbd {
      font-family: var(--font-ui);
      font-size: var(--size-2xs);
      padding: 0 var(--space-1);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
    }
    /* Paper field — 85% of experience */
    .canvas-wrap {
      background: var(--color-bg-canvas);
      display: flex;
      justify-content: center;
      padding: var(--space-12) var(--space-6) var(--space-16);
      position: relative;
    }
    .canvas {
      width: 100%;
      max-width: var(--canvas-max);
      font-family: var(--font-text);
      font-size: var(--size-xl);
      line-height: var(--line-body);
      color: var(--color-text-primary);
      unicode-bidi: plaintext;
    }
    .canvas h1 {
      font-family: var(--font-display);
      font-size: var(--size-3xl);
      font-weight: var(--weight-regular);
      line-height: var(--line-display);
      margin: 0 0 var(--space-8);
      color: var(--color-ink);
    }
    .canvas p {
      margin: 0 0 var(--space-5);
    }
    .canvas p.verse {
      margin-bottom: var(--space-3);
    }
    .canvas ::selection {
      background: var(--color-bg-selection);
    }
    .latin-inline {
      font-family: var(--font-text);
      dir: ltr;
      unicode-bidi: isolate;
    }
    /* Lamp edge: thin status, not chat dock */
    .status {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-2) var(--space-6);
      background: var(--color-bg-chrome);
      border-top: 1px solid var(--color-border-subtle);
      font-size: var(--size-xs);
      color: var(--color-text-tertiary);
    }
    .status-local {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .status-local::before {
      content: "";
      width: 6px; height: 6px;
      border-radius: var(--radius-full);
      background: var(--color-accent);
    }
    /* lamp-open: overlay + palette */
    .overlay {
      position: fixed;
      inset: 0;
      background: var(--color-bg-overlay);
      animation: lamp-backdrop var(--duration-slow) var(--ease-linear) both;
      z-index: 40;
    }
    @keyframes lamp-backdrop {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .palette {
      position: fixed;
      top: 18%;
      left: 50%;
      transform: translateX(-50%);
      width: min(var(--palette-width), calc(100% - var(--space-8)));
      background: var(--color-bg-elevated);
      border-radius: var(--radius-lg);
      box-shadow: var(--elevation-palette);
      border: 1px solid var(--color-border-strong);
      z-index: 50;
      overflow: hidden;
      animation: lamp-panel var(--duration-base) var(--ease-standard) both;
    }
    @keyframes lamp-panel {
      from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    .palette-input-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .palette-input-row .lamp-tick {
      width: 3px;
      height: 1.1em;
      background: var(--color-focus-ring);
      border-radius: var(--radius-sm);
      animation: ink-settle var(--duration-fast) var(--ease-standard) both;
    }
    @keyframes ink-settle {
      from { opacity: 0; transform: scaleY(0.96); }
      to { opacity: 1; transform: scaleY(1); }
    }
    .palette-input {
      flex: 1;
      border: 0;
      outline: none;
      background: transparent;
      font-family: var(--font-ui);
      font-size: var(--size-md);
      font-weight: var(--weight-medium);
      color: var(--color-text-primary);
      line-height: var(--line-ui);
    }
    .palette-input::placeholder {
      color: var(--color-text-tertiary);
    }
    .palette-list {
      list-style: none;
      margin: 0;
      padding: var(--space-2);
      max-height: 16rem;
      overflow: auto;
    }
    .palette-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-3);
      border-radius: var(--radius-md);
      font-size: var(--size-sm);
      color: var(--color-text-secondary);
      cursor: default;
      transition: background-color var(--duration-base) var(--ease-standard);
    }
    .palette-item.active {
      background: var(--color-accent-soft);
      color: var(--color-text-primary);
    }
    .palette-item .cmd {
      font-weight: var(--weight-medium);
      color: var(--color-text-primary);
    }
    .palette-item .hint {
      font-size: var(--size-2xs);
      color: var(--color-text-tertiary);
      font-family: var(--font-ui);
      letter-spacing: 0.02em;
    }
    .palette-foot {
      padding: var(--space-2) var(--space-5) var(--space-3);
      border-top: 1px solid var(--color-border-subtle);
      font-size: var(--size-2xs);
      color: var(--color-text-tertiary);
      display: flex;
      justify-content: space-between;
    }
    .underline-soft {
      box-decoration-break: clone;
      background: linear-gradient(transparent 70%, var(--color-accent-soft) 70%);
      transition: background-color var(--duration-base) var(--ease-standard);
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>سِرَاج</span>
      </div>
      <div class="top-meta">مسوّدة · محلي · <kbd>Ctrl</kbd>+<kbd>K</kbd></div>
    </header>

    <main class="canvas-wrap">
      <article class="canvas" contenteditable="true" spellcheck="false" aria-label="لوحة الكتابة">
        <h1>على حافّة الضوء</h1>
        <p class="verse">أكتبُ والليلُ جارٌ على المكتب،</p>
        <p class="verse">كأنّ القصيدةَ مصباحٌ صغير</p>
        <p class="verse">لا يسألُ أحداً، ولا يجيب.</p>
        <p>
          في الموضع الذي اعتادت فيه البرامجُ أن تفتحَ حواراً، أُبقي الصفحةَ فارغةً إلا من الحبر.
          الاقتراحُ يأتي من الهامش: كلمةٌ تُضاء، لا صوتٌ يقاطع.
          إن احتجتَ عوناً، افتح السراج — لا المحادثة.
        </p>
        <p>
          هذا السطر يتضمّن اسماً لاتينياً: <span class="latin-inline" lang="en" dir="ltr">Ibn al-Rūmī</span> —
          بنفس الحجم، بلا زخرفة دخيلة.
        </p>
        <p>
          <span class="underline-soft">الجملة التي تُراجع الآن</span> تُضاء بلمسة هامشية، لا بفقاعة.
        </p>
      </article>
    </main>

    <footer class="status">
      <span class="status-local">محفوظ محلياً · بلا شبكة</span>
      <span>٤٢ كلمة · قصيدة / مقال</span>
    </footer>
  </div>

  <!-- Command palette open (lamp-open) -->
  <div class="overlay" aria-hidden="true"></div>
  <div class="palette" role="dialog" aria-modal="true" aria-label="أوامر سراج">
    <div class="palette-input-row">
      <span class="lamp-tick" aria-hidden="true"></span>
      <input class="palette-input" type="text" value="صفّ" aria-label="أمر" autofocus />
    </div>
    <ul class="palette-list">
      <li class="palette-item active">
        <span class="cmd">صفّ السطر كبيت شعر</span>
        <span class="hint">Enter</span>
      </li>
      <li class="palette-item">
        <span class="cmd">اقترح قافية من المسوّدة</span>
        <span class="hint">محلي</span>
      </li>
      <li class="palette-item">
        <span class="cmd">اختصر الفقرة دون تغيير النبرة</span>
        <span class="hint">محلي</span>
      </li>
      <li class="palette-item">
        <span class="cmd">أظهر العدّ العروضي</span>
        <span class="hint">⌥ M</span>
      </li>
      <li class="palette-item">
        <span class="cmd">تصدير Markdown</span>
        <span class="hint">⌘ E</span>
      </li>
    </ul>
    <div class="palette-foot">
      <span>سراج · أداة لا محاور</span>
      <span>↑↓ اختيار · Esc يغلق</span>
    </div>
  </div>
</body>
</html>
```

*(Demo ≤400 lines; self-contained; token-only styling. Open the HTML block in a browser to view.)*

---

## 7. FORBIDDEN LIST

This brand **never**:

1. **Uses chat bubbles, threaded “assistant” messages, or an AI avatar** — SIRAJ is a lamp, not a interlocutor.  
2. **Applies electric purple/cyan “AI” gradients or glassy multi-stop brand blobs** on chrome or empty states.  
3. **Animates typing, token streaming bounce, or typewriter reveals** of generated text.  
4. **Centers a prompt box as the home screen** (“Ask anything…”) instead of the paper canvas.  
5. **Sets body Arabic in a geometric Latin sans** or uses decorative calligraphic display for UI chrome.  
6. **Uses pure `#000` / `#FFF` or cool blue-gray SaaS neutrals** as primary paper/ink (breaks lamp/paper derivation).  
7. **Adds notification badges, confetti, achievement toasts, or gamified word-count celebrations.**  
8. **Markets cloud sync as default identity** or shows “online presence” of a model — local-first is structural, not a footnote.

---

*End of SIRAJ visual identity system.*
