# SIRAJ — Visual Identity System
> A quiet, serious instrument for Arabic poets and essayists. Local-first.

### 1. CONCEPT (89 words)

**Inverted Illumination.** Historical manuscripts applied gold leaf to make text emit light. SIRAJ inverts this: the paper itself emits a low, still light; ink is cold matter that absorbs it and becomes legible.

SIRAJ is not a generator. It is a stone oil-lamp left on a closed desk in a night library. The AI does not speak, it moves the lamp closer to what you already wrote.

Consequences: No chat streams. No floating UI. Text must feel like iron-gall ink settling into mulberry fiber, not tokens streaming. Intelligence lives only in the margin (الحاشية). Default is night. Light is scarce and fixed.

---
### 2. TYPOGRAPHY

**Arabic-first, not Arabic-compatible.**

*   **Display / عناوين:** `Amiri` (Naskh). Only Regular 400. Never Bold. Used for essay titles, diwan section heads, file names. High contrast, sharp terminals evoke cut nib. Tracking +1.5%.
*   **Text / متن:** `Noto Naskh Arabic` — `IBM Plex Sans Arabic` fallback. 400 / 500 only. For body essay, poetry. Line-height: 2.1 (poetry) 1.9 (prose). Maximum 34em measure. Optical size tunes to paper absorption.
*   **UI / حاشية:** `IBM Plex Sans Arabic Text` 400, 500. Small, dry, uninked. For chrome, marginalia, command labels. Allcaps never.

**Scale (based on 16px Arabic em, ratio 1.25 Major Third):**
`11 / 12.5 / 14 / 16 / 20 / 25 / 31 / 39 / 48 / 61` — UI never exceeds 14. Text uses 20. Display uses 31-48.

**Rules for Latin embedded in Arabic:**
1. Latin is always 90% of current Arabic size (`--latin-scale: 0.9`).
2. Family locked to `IBM Plex Sans Latin` — never serif.
3. Baseline aligned to Arabic middle (not bottom), `vertical-align: middle -0.1em`.
4. Weight -1 step lighter than Arabic (if Arabic 500, Latin 400).
5. Italic forbidden. Use opacity 0.8 and tracking +2% for emphasis.
6. Numbers use tabular lining only inside poetry meter table; elsewhere old-style.

---
### 3. COLOR

**Derivation:** From lamp, paper, ink — all physical. No screen color.

*   **Waraq war (Paper):** unbleached mulberry ` #FDF6EC`
*   **Midad (Iron-gall ink):** oxidized black-olive `#15140F`
*   **Noor (Sesame oil flame):** low amber `#D9A441`
*   **Ramad (Cold ash):** stone border `#9A958E`
*   **Sukun (Night stone):** library basalt `#0F0F10`

**Light Mode (Day Proof):**
- `--bg: #FDF6EC` Waraq 
- `--surface: #F7EEDC` Waraq-Deep
- `--surface-2: #EFE3C8` Edge
- `--ink: #15140F` 15.8:1 on bg
- `--ink-soft: #5B574F` 7.2:1
- `--ink-faint: #9A958E` 4.1:1 on surface, for hashiya only
- `--line: #E6D9BB` 1px hairlines
- `--noor: #D9A441` accent, 3:1 max — never for text, only for lamp ring / focus
- `--noor-soft: #F0D9A0` wash
- `--focus: #B47A1E`

**Dark Mode (Default, Layl):**
- `--bg: #0F0F10` Sukun
- `--surface: #1A1A1E` Stone
- `--surface-2: #25251F` Stone-lit
- `--ink: #EAE2D0` Waraq reverse 14.9:1 on bg
- `--ink-soft: #A8A29A` 7.0:1
- `--ink-faint: #6E6B66` hashiya
- `--line: #2A2A26`
- `--noor: #D9A441` 8.2:1 on bg for ring only
- `--noor-soft: #332A14` lamp spill
- `--focus: #E6B85C`

Intent: Contrast is textual, not chromatic. Ink does all work. Noor never fills large areas, only 2px rings or inner glow.

---
### 4. MOTION

Quiet ink, not interface.

**Durations:** `micro: 160ms` (focus), `midad: 320ms` (default), `kashf: 640ms` (reveal, command palette).

**Easings:**
- `--ease-midad: cubic-bezier(0.42, 0, 0.18, 1)` — ink settling, quick start, slow absorption.
- `--ease-waraq: cubic-bezier(0.16, 1, 0.3, 1)` — paper shifting, damped.
- `--ease-sukun: cubic-bezier(0.4, 0, 0.6, 1)` — breath, symmetrical.

**What NEVER animates:** 
Character content, line-height, Arabic justification, font-weight, letter-spacing of body, background of reading area, any bouncing / scaling >2%, blur, gradient rotation.

**3 Signature Moves:**
1.  **حبر يجف / Hibr Yajif (Ink Dries):** New AI marginalia appears at 0.94 opacity + slightly lighter `--ink-faint`, then over 320ms settles to `--ink-soft` at 1.0 with `ease-midad`. No movement, only density.
2.  **كشف / Kashf (Lift the Lamp):** Command palette does not pop. Surface lifts 2px + inner glow expands from 12px to 28px with `ease-waraq 640ms`. Content fades up 8px max.
3.  **سكون / Sukun (Hold):** On idle 900ms after typing, cursor thickens from 1px to 2px and Noor ring dims 40% — instrument breathing, eased with `ease-sukun 640ms`. Never blinks.

---
### 5. TOKENS

```json
{
  "color": {
    "light": {
      "bg": "#FDF6EC",
      "surface": "#F7EEDC",
      "surface2": "#EFE3C8",
      "ink": "#15140F",
      "inkSoft": "#5B574F",
      "inkFaint": "#9A958E",
      "line": "#E6D9BB",
      "noor": "#D9A441",
      "noorSoft": "#F0D9A0",
      "focus": "#B47A1E"
    },
    "dark": {
      "bg": "#0F0F10",
      "surface": "#1A1A1E",
      "surface2": "#25251F",
      "ink": "#EAE2D0",
      "inkSoft": "#A8A29A",
      "inkFaint": "#6E6B66",
      "line": "#2A2A26",
      "noor": "#D9A441",
      "noorSoft": "#332A14",
      "focus": "#E6B85C"
    }
  },
  "type": {
    "display": "'Amiri', 'Noto Naskh Arabic', 'Traditional Arabic', serif",
    "text": "'Noto Naskh Arabic', 'IBM Plex Sans Arabic', serif",
    "ui": "'IBM Plex Sans Arabic', 'Noto Sans Arabic', system-ui, sans-serif",
    "latin": "'IBM Plex Sans Arabic', 'IBM Plex Sans', sans-serif",
    "size": {
      "uiMicro": "11px",
      "ui": "12.5px",
      "uiLarge": "14px",
      "base": "16px",
      "text": "20px",
      "h4": "25px",
      "h3": "31px",
      "h2": "39px",
      "h1": "48px"
    },
    "weight": { "regular": 400, "medium": 500 },
    "lineHeight": { "ui": 1.4, "text": 1.9, "poetry": 2.1 },
    "tracking": { "display": "0.015em", "ui": "0.02em", "latinInArabic": "0.02em" },
    "latinScale": 0.9
  },
  "space": {
    "xs": "4px",
    "sm": "8px",
    "md": "12px",
    "lg": "16px",
    "xl": "24px",
    "2xl": "32px",
    "3xl": "48px",
    "4xl": "64px",
    "5xl": "96px"
  },
  "radius": {
    "xs": "2px",
    "sm": "4px",
    "md": "8px",
    "lg": "12px",
    "paper": "14px",
    "full": "999px"
  },
  "motion": {
    "duration": { "micro": "160ms", "midad": "320ms", "kashf": "640ms" },
    "ease": {
      "midad": "cubic-bezier(0.42, 0, 0.18, 1)",
      "waraq": "cubic-bezier(0.16, 1, 0.3, 1)",
      "sukun": "cubic-bezier(0.4, 0, 0.6, 1)"
    }
  }
}
```

---
### 6. DEMO — Canvas + Command Palette (Hashiya)

```html
<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIRAJ — لوحة</title>
<style>
:root{
--bg:#0F0F10;--surface:#1A1A1E;--surface2:#25251F;--ink:#EAE2D0;
--ink-soft:#A8A29A;--ink-faint:#6E6B66;--line:#2A2A26;--noor:#D9A441;
--noor-soft:#332A14;--focus:#E6B85C;
--display:'Amiri','Noto Naskh Arabic','Traditional Arabic',serif;
--text:'Noto Naskh Arabic','IBM Plex Sans Arabic',serif;
--ui:'IBM Plex Sans Arabic','Noto Sans Arabic',system-ui,sans-serif;
--xs:4px;--sm:8px;--md:12px;--lg:16px;--xl:24px;--2xl:32px;--3xl:48px;
--r-sm:4px;--r-md:8px;--r-paper:14px;
--micro:160ms;--midad:320ms;--kashf:640ms;
--em: cubic-bezier(0.42,0,0.18,1);--ew: cubic-bezier(0.16,1,0.3,1);
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--text);
display:grid;place-items:center;padding:var(--xl)}
.paper{
width:min(720px,94vw);background:linear-gradient(180deg,var(--surface2),var(--surface));
border:1px solid var(--line);border-radius:var(--r-paper);
box-shadow:inset 0 0 0 1px var(--line), inset 0 0 80px var(--noor-soft), 0 24px 80px #0008;
padding:var(--3xl) var(--2xl);position:relative;
animation:kashf var(--kashf) var(--ew) both}
.paper:before{content:'';position:absolute;inset:0;border-radius:inherit;
box-shadow:inset 0 1px 0 0 var(--line), inset 0 -60px 100px -10px var(--noor-soft);
pointer-events:none;opacity:.9}
.top{display:flex;justify-content:space-between;align-items:center;
font-family:var(--ui);font-size:11px;color:var(--ink-faint);letter-spacing:.08em}
.top b{font-weight:500;color:var(--ink-soft)}
.lamp-ring{width:18px;height:18px;border:1.5px solid var(--noor);border-radius:50%;
box-shadow:0 0 14px var(--noor-soft), inset 0 0 8px var(--noor-soft)}
h1{font-family:var(--display);font-weight:400;font-size:39px;line-height:1.2;
margin:var(--xl) 0 var(--md);letter-spacing:.015em}
.meta{font-family:var(--ui);font-size:12.5px;color:var(--ink-faint);margin-bottom:var(--2xl)}
.meta span{color:var(--ink-soft)}
.poem{font-size:20px;line-height:2.1}
.poem p{margin:0 0 var(--lg)}
.poem .ink{animation:hibr var(--midad) var(--em) both}
.poem i{font-style:normal;color:var(--ink-faint)}
.latin{font-family:var(--ui);font-size:90%;vertical-align:middle;opacity:.8;letter-spacing:.02em}
.cursor{display:inline-block;width:1px;height:1.2em;background:var(--ink);
vertical-align:-0.15em;margin-inline:2px;animation:sukun var(--kashf) cubic-bezier(0.4,0,0.6,1) infinite alternate}
.palette{position:absolute;left:50%;top:56%;transform:translate(-50%,-50%);
width:min(460px,92%);background:var(--surface);border:1px solid var(--line);
border-radius:12px;box-shadow:0 0 0 1px var(--line), 0 0 0 6px var(--noor-soft), 0 20px 60px #0009;
overflow:hidden;animation:kashfUp var(--kashf) var(--ew) .05s both}
.phead{display:flex;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);font-family:var(--ui);font-size:12.5px;color:var(--ink-faint)}
.dot{width:28px;height:28px;background:var(--surface2);border:1px solid var(--line);
border-radius:8px;display:grid;place-items:center;color:var(--noor);font-size:12px}
.phead b{color:var(--ink);font-weight:500;font-size:14px}
.list{padding:8px}
.row{display:flex;justify-content:space-between;align-items:center;
padding:10px 12px;border-radius:8px;font-family:var(--ui);font-size:13px;color:var(--ink-soft)}
.row.active{background:var(--surface2);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.row.active .hint{color:var(--ink-faint)}
.k{display:flex;gap:6px;align-items:center}
.k kbd{font-family:var(--ui);font-size:11px;border:1px solid var(--line);
background:var(--surface);border-bottom-width:2px;border-radius:4px;padding:2px 5px;color:var(--ink-faint)}
.hint{font-size:11px;color:var(--ink-faint)}
.foot{padding:10px 14px;border-top:1px solid var(--line);font-family:var(--ui);
font-size:11px;color:var(--ink-faint);display:flex;justify-content:space-between}
.hashiya{position:absolute;left:-86px;top:260px;writing-mode:vertical-rl;
font-family:var(--ui);font-size:11px;color:var(--ink-faint);letter-spacing:.12em;opacity:.7}
@keyframes hibr{from{opacity:.85;color:var(--ink-faint)}to{opacity:1;color:var(--ink)}}
@keyframes kashf{from{transform:translateY(6px);box-shadow:inset 0 0 0 1px var(--line)} to{transform:none}}
@keyframes kashfUp{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes sukun{from{height:1.2em;opacity:1}to{height:1.45em;opacity:.6}}
@media(max-width:900px){.hashiya{display:none}.paper{padding:28px 20px}}
</style>
<div class="paper">
<div class="hashiya">الحاشية — لا متن</div>
<div class="top"><b>سراج / sirāj.local</b><div class="lamp-ring"></div><span>ليْل • 12 ورقة • محلي</span></div>
<h1>بيتٌ لا يُضاء يُنسى</h1>
<div class="meta"><span>وزن:</span> طويل • <span>قافية:</span> ياء • <span class="latin">local-only</span></div>
<div class="poem">
<p class="ink">إذا جنّ <i>اللّيلُ</i> واشتهى الورقُ ظلاً<br>تركتُ السراجَ <span class="cursor"></span> يدنو ولا يتكلّمُ</p>
<p class="ink" style="animation-delay:.06s">لا يخطّ، بل يُري الحِبرَ أينَ ثَقُل<br>ولا يَزيد، بل يَنقصُ الظُلمةَ عِلْمُ</p>
<p class="ink" style="animation-delay:.12s">هنا لا سؤالَ، هنا لا جوابَ سريعْ<br>هنا حاشيةٌ تحفظُ ما يُفهمُ</p>
</div>
<div class="palette" role="dialog" aria-label="حاشية الأوامر">
<div class="phead"><div class="dot">◐</div><b>الحاشية</b><span style="margin-inline:auto">— أين أقرّب الضوء؟</span><span>⌘K</span></div>
<div class="list">
<div class="row active"><span>اشرح وزن هذا الشطر</span><span class="k"><kbd>↵</kbd><span class="hint">مُداراة</span></span></div>
<div class="row"><span>أصل كلمة: يجفّ</span><span class="hint">لسان • ٣ جذور</span></div>
<div class="row"><span>زن الصدر والعجز</span><span class="hint">تفعيلة</span></div>
<div class="row"><span>قارن بنسخة ٢ - أمس</span><span class="hint">diff ورق</span></div>
<div class="row"><span>احفظ كهامش، لا تُغيّر المتن</span><span class="k"><kbd>⌘</kbd><kbd>S</kbd></span></div>
</div>
<div class="foot"><span>الذكاء لا يكتب — يضيء فقط</span><span><span class="latin" style="font-size:11px">no cloud</span> • نور ساكن</span></div>
</div>
</div>
</html>
```

---
### 7. FORBIDDEN LIST

1.  **No chat bubbles, no streaming dots, no “AI is typing…”** — SIRAJ never pretends to be a conversational other.
2.  **No purple/blue gradients, glassmorphism blur, or neon aura** — light is sesame amber and scarce.
3.  **No bold Arabic ever** — weight is 400/500 only; emphasis via density, not mass.
4.  **No centered floating AI avatars, sparkles ✦, or magic wands** — intelligence has no face.
5.  **No generative placeholders that overwrite the متن** — AI may only write to hashiya (margin/palette), never auto-replace.
6.  **No italic Arabic, no Latin sentence-case inside Arabic poetry** — Latin is always smaller, drier, 90%.
7.  **No animation of line-height, tracking, or font-weight** — only opacity and oil-lamp glow; text never jitters.
8.  **No cloud badges, “online”, or abstract network graphics** — brand copy says `sirāj.local` and stone-lamp only; local-first is literal.
