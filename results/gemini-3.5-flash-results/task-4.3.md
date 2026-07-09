# هُوية سِرَاج البصرية | SIRAJ Visual Identity System

---

## 1. CONCEPT (المفهوم الإرشادي)
**The Scribe's Parchment and Carbon Ink (الرَّقّ وَالمِدَاد)**

Siraj rejects glowing, hyperactive digital interfaces. It treats the screen as a physical sheet of seasoned parchment (*raqq*) holding carbon ink (*midad*). The AI behaves not as a conversational chat partner, but as an underlaid carbon guide. It materializes as structural guidelines (*mistarah*) and faint ink washes (*al-kimiya*) beneath the text, supporting meter and poetic rules without interrupting the writer’s focus. There are no cards, chat bubbles, or floating buttons; all assistance is bound directly to the layout's structural lines, enforcing a quiet, serious workspace.

---

## 2. TYPOGRAPHY (الخطوط والنسب البصرية)

*   **Arabic-First Pairing Strategy**:
    *   **Display & Poetry**: **Amiri** (Naskh style). A classical typeface based on the historic Bulaq Press design, preserving deep calligraphic rules and elegant descenders for poetic hemistichs.
    *   **Body Prose & UI**: **IBM Plex Sans Arabic** (Kufic-influenced). Offers modern geometric clarity while retaining native Arabic baseline rhythms, making it highly readable in compact environments.
*   **Scale (Numeric)**:
    *   `xs` (12px / 0.75rem): Metrical weights, keyboard hints, system statuses.
    *   `sm` (14px / 0.875rem): UI labels, command list descriptions.
    *   `md` (18px / 1.125rem): Standard body prose, essays.
    *   `lg` (24px / 1.5rem): Poetic hemistichs (Sadr/Aruz), section headers.
    *   `xl` (36px / 2.25rem): Manuscript titles.
*   **Rules for Latin Embedded in Arabic**:
    *   **Font Matching**: Render all Latin text in **IBM Plex Sans** to preserve uniform stroke weights.
    *   **Optical Alignment**: Latin text must be scaled to `90%` of the surrounding Arabic font size (e.g., using `font-size-adjust: 0.45` or `font-size: 0.9em`) to prevent high ascenders from visually dominating the Arabic baseline.
    *   **Directional Safety**: Wrap Latin sections in a `<span dir="ltr" class="latin-embed">` tag with `unicode-bidi: isolate` to enforce correct punctuation flow.

---

## 3. COLOR (الألوان والتباين)

### Color Palette

| Token Name | Light Mode (Hex) | Dark Mode (Hex) | Intent & Meaning |
| :--- | :--- | :--- | :--- |
| `color-raqq-bg` | `#FBF9F4` | `#121110` | Warm parchment paper / Soot-charred slate |
| `color-midad-ink` | `#1A1917` | `#EBE7DF` | Thick carbon black ink / Bleached bone |
| `color-midad-muted` | `#6E6759` | `#A8A092` | Muted ink wash for secondary metadata |
| `color-mistarah-grid`| `#D4CBB5` | `#3A3630` | Lead ruling guidelines |
| `color-al-kimiya` | `#EADFC9` | `#26231E` | AI underlay / subtle ink-soak highlights |
| `color-shanjarf-red` | `#A94442` | `#E07A78` | Cinnabar red for metrical breaks and errors |

### Contrast Intent
*   **Ink on Parchment (`color-midad-ink` / `color-raqq-bg`)**: Contrast exceeds **11:1** (exceeds WCAG AAA) for ultimate reading clarity.
*   **Guidelines (`color-mistarah-grid` / `color-raqq-bg`)**: Low contrast (**2.5:1**) designed to sit below conscious perception unless actively writing or aligning text.
*   **AI Underlay (`color-al-kimiya`)**: Functions strictly as a background wash behind primary ink text. Contrast with overlaying ink remains above **7:1**.

---

## 4. MOTION (الحركة والتحولات)

### Principles
*   **Quietude**: No bounces, elastic springs, or overshoot curves.
*   **Efficiency**: Rapid, micro-transitions preserving the local-first feel.
*   **Sacred Layout**: Never animate font weight, letter spacing, or line height to avoid layout reflows that distract the writer's eye.

### Signature Moves
1.  **Midad Bleed (انتشار المداد)**: Used for AI suggestion insertions. The text fades in with a micro-blur effect (`filter: blur(4px) -> blur(0px)`) over 280ms, mimicking ink expanding into dry paper fibers.
2.  **Mistarah Draw (تخطيط المسطرة)**: Guideline dividers scale in horizontally (`transform: scaleX(0) -> scaleX(1)`) from the center outward, simulating a scribe drawing structural paths.
3.  **Kashida Stretch (تمديد الكشيدة)**: The command palette expands horizontally first (0ms to 120ms), followed by a swift vertical reveal (120ms to 280ms), imitating classical letter elongation.

---

## 5. TOKENS (رموز التصميم)

```json
{
  "name": "Siraj Tokens",
  "version": "1.0.0",
  "color": {
    "light": {
      "raqq": "#FBF9F4",
      "midad": "#1A1917",
      "midad-muted": "#6E6759",
      "mistarah": "#D4CBB5",
      "al-kimiya": "#EADFC9",
      "shanjarf": "#A94442",
      "overlay": "rgba(26, 25, 23, 0.4)"
    },
    "dark": {
      "raqq": "#121110",
      "midad": "#EBE7DF",
      "midad-muted": "#A8A092",
      "mistarah": "#3A3630",
      "al-kimiya": "#26231E",
      "shanjarf": "#E07A78",
      "overlay": "rgba(18, 17, 16, 0.7)"
    }
  },
  "typography": {
    "fontFamily": {
      "display": "'Amiri', serif",
      "text": "'IBM Plex Sans Arabic', sans-serif"
    },
    "fontSize": {
      "xs": "0.75rem",
      "sm": "0.875rem",
      "md": "1.125rem",
      "lg": "1.5rem",
      "xl": "2.25rem"
    },
    "fontWeight": {
      "light": 300,
      "regular": 400,
      "medium": 500,
      "bold": 700
    }
  },
  "space": {
    "1": "4px",
    "2": "8px",
    "3": "16px",
    "4": "24px",
    "5": "32px",
    "6": "48px"
  },
  "radius": {
    "none": "0px",
    "sm": "2px",
    "md": "4px"
  },
  "motion": {
    "duration": {
      "fast": "120ms",
      "slow": "280ms"
    },
    "easing": {
      "expo-out": "cubic-bezier(0.16, 1, 0.3, 1)"
    }
  }
}
```

---

## 6. DEMO (لوحة الكتابة التفاعلية)

Save the following code as an `.html` file. It instantiates the light/dark modes, custom Amiri typography, and the command palette triggered by `Ctrl+K`.

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>سراج | SIRAJ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    /* TOKENS MAPPED TO CSS VARIABLES */
    :root {
      --color-raqq: #FBF9F4;
      --color-midad: #1A1917;
      --color-midad-secondary: #6E6759;
      --color-mistarah: #D4CBB5;
      --color-al-kimiya: #EADFC9;
      --color-accent-red: #A94442;
      --color-overlay-bg: rgba(26, 25, 23, 0.4);

      --font-display: 'Amiri', serif;
      --font-text: 'IBM Plex Sans Arabic', sans-serif;
      
      --font-size-xs: 0.75rem;
      --font-size-sm: 0.875rem;
      --font-size-md: 1.125rem;
      --font-size-lg: 1.5rem;
      --font-size-xl: 2.25rem;

      --font-weight-light: 300;
      --font-weight-regular: 400;
      --font-weight-medium: 500;
      --font-weight-bold: 700;

      --space-1: 4px;
      --space-2: 8px;
      --space-3: 16px;
      --space-4: 24px;
      --space-5: 32px;
      --space-6: 48px;

      --radius-none: 0px;
      --radius-sm: 2px;

      --motion-duration-fast: 120ms;
      --motion-duration-slow: 280ms;
      --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    }

    body.dark-mode {
      --color-raqq: #121110;
      --color-midad: #EBE7DF;
      --color-midad-secondary: #A8A092;
      --color-mistarah: #3A3630;
      --color-al-kimiya: #26231E;
      --color-accent-red: #E07A78;
      --color-overlay-bg: rgba(18, 17, 16, 0.7);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--color-raqq);
      color: var(--color-midad);
      font-family: var(--font-text);
      font-weight: var(--font-weight-regular);
      line-height: 1.6;
      transition: background-color var(--motion-duration-slow) var(--motion-ease-out), color var(--motion-duration-slow) var(--motion-ease-out);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-4) var(--space-6);
      border-bottom: 1px solid var(--color-mistarah);
    }

    .brand {
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    
    .brand-dot {
      width: 6px;
      height: 6px;
      background-color: var(--color-accent-red);
      transform: rotate(45deg);
    }

    .nav-actions {
      display: flex;
      gap: var(--space-3);
    }

    button.icon-btn {
      background: none;
      border: 1px solid var(--color-mistarah);
      color: var(--color-midad);
      cursor: pointer;
      font-family: var(--font-text);
      font-size: var(--font-size-sm);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-none);
      transition: all var(--motion-duration-fast) var(--motion-ease-out);
    }

    button.icon-btn:hover {
      background-color: var(--color-al-kimiya);
      border-color: var(--color-midad);
    }

    main.writing-canvas {
      flex: 1;
      max-width: 800px;
      width: 100%;
      margin: 0 auto;
      padding: var(--space-6) var(--space-4);
    }

    .manuscript-title {
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      text-align: center;
      margin-bottom: var(--space-5);
      font-weight: var(--font-weight-regular);
      border-bottom: 1px dashed var(--color-mistarah);
      padding-bottom: var(--space-3);
      outline: none;
    }

    .poem-editor {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    .poem-row {
      display: grid;
      grid-template-columns: 1fr 40px 1fr;
      align-items: center;
      position: relative;
      padding: var(--space-2) 0;
    }

    .hemistich {
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      border: none;
      background: transparent;
      color: var(--color-midad);
      outline: none;
      resize: none;
      width: 100%;
      text-align: right;
    }

    .hemistich.aruz {
      text-align: left;
    }

    .bayt-divider {
      display: flex;
      justify-content: center;
      align-items: center;
      color: var(--color-mistarah);
      font-family: var(--font-display);
      font-size: var(--font-size-sm);
      user-select: none;
    }

    .poem-row::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 1px;
      background-color: var(--color-mistarah);
      opacity: 0.3;
    }

    .ai-suggested-row {
      background-color: var(--color-al-kimiya);
      border-radius: var(--radius-none);
      animation: midadBleed var(--motion-duration-slow) var(--motion-ease-out);
      position: relative;
    }

    .ai-marker {
      position: absolute;
      right: -130px;
      width: 110px;
      top: 50%;
      transform: translateY(-50%);
      font-size: var(--font-size-xs);
      color: var(--color-accent-red);
      border-right: 2px solid var(--color-accent-red);
      padding-right: var(--space-2);
      text-align: right;
      pointer-events: none;
    }

    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--color-overlay-bg);
      backdrop-filter: blur(1px);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 15vh;
      z-index: 100;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--motion-duration-slow) var(--motion-ease-out);
    }

    .modal-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .command-palette {
      background-color: var(--color-raqq);
      border: 1px solid var(--color-midad);
      width: 100%;
      max-width: 500px;
      border-radius: var(--radius-none);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      transform: scale(0.98);
      transition: transform var(--motion-duration-slow) var(--motion-ease-out);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .modal-backdrop.open .command-palette {
      transform: scale(1);
    }

    .search-container {
      position: relative;
      border-bottom: 1px solid var(--color-mistarah);
    }

    .search-input {
      width: 100%;
      background: transparent;
      border: none;
      outline: none;
      color: var(--color-midad);
      font-family: var(--font-text);
      font-size: var(--font-size-md);
      padding: var(--space-3) var(--space-4);
    }

    .search-shortcut {
      position: absolute;
      left: var(--space-3);
      top: 50%;
      transform: translateY(-50%);
      font-size: var(--font-size-xs);
      color: var(--color-midad-secondary);
      border: 1px solid var(--color-mistarah);
      padding: 1px var(--space-1);
      direction: ltr;
    }

    .palette-results {
      max-height: 240px;
      overflow-y: auto;
      list-style: none;
    }

    .palette-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-3) var(--space-4);
      cursor: pointer;
      border-bottom: 1px solid rgba(212, 203, 181, 0.15);
      transition: background-color var(--motion-duration-fast) var(--motion-ease-out);
    }

    .palette-item:hover, .palette-item.active {
      background-color: var(--color-al-kimiya);
    }

    .palette-item-title {
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-sm);
    }

    .palette-item-desc {
      font-size: var(--font-size-xs);
      color: var(--color-midad-secondary);
      margin-top: 2px;
    }

    .palette-item-shortcut {
      font-size: var(--font-size-xs);
      color: var(--color-midad-secondary);
      direction: ltr;
    }

    footer {
      border-top: 1px solid var(--color-mistarah);
      padding: var(--space-3) var(--space-6);
      display: flex;
      justify-content: space-between;
      font-size: var(--font-size-xs);
      color: var(--color-midad-secondary);
    }

    .latin-embed {
      font-size-adjust: 0.45;
      font-family: var(--font-text);
    }

    @keyframes midadBleed {
      0% { filter: blur(3px); opacity: 0; }
      100% { filter: blur(0); opacity: 1; }
    }
  </style>
</head>
<body class="dark-mode">
  <div class="app-container">
    <header>
      <div class="brand">
        <div class="brand-dot"></div>
        سِـرَاج
      </div>
      <div class="nav-actions">
        <button class="icon-btn" onclick="toggleTheme()">نهاري / ليلي</button>
        <button class="icon-btn" onclick="openPalette()">لوحة الأوامر (Ctrl+K)</button>
      </div>
    </header>

    <main class="writing-canvas">
      <div class="manuscript-title" contenteditable="true">الديوان المقارن</div>
      
      <div class="poem-editor">
        <div class="poem-row">
          <div class="hemistich sadr" contenteditable="true">الخَيْلُ وَاللّيْلُ وَالبَيْدَاءُ تَعْرِفُنِي</div>
          <div class="bayt-divider">::</div>
          <div class="hemistich aruz" contenteditable="true">وَالسّيْفُ وَالرّمْحُ وَالقِرْطَاسُ وَالقَلَمُ</div>
        </div>

        <div class="poem-row ai-suggested-row">
          <div class="hemistich sadr" contenteditable="true">صَحِبْتُ فِي الفَلَواتِ الوَحْشَ مُنْفَرِداً</div>
          <div class="bayt-divider">::</div>
          <div class="hemistich aruz" contenteditable="true">حَتَّى تَعَجَّبَ مِنِّي الكُورُ وَالأَكَمُ</div>
          <div class="ai-marker">بحر البسيط (اقتراح)</div>
        </div>

        <div class="poem-row">
          <div class="hemistich sadr" contenteditable="true">أَقَلُّ فِعْلٍ سَمِعْنَا بَاسِمِهِ كَرَمٌ</div>
          <div class="bayt-divider">::</div>
          <div class="hemistich aruz" contenteditable="true">وَأَكْثَرُ القَوْلِ مِمَّا لَيْسَ يُلْتَزَمُ</div>
        </div>
      </div>
    </main>

    <footer>
      <div>سراج — بيئة كتابة صامتة ومحلية</div>
      <div class="latin-embed" dir="ltr">V1.0.0 (Local-First)</div>
    </footer>
  </div>

  <div class="modal-backdrop open" id="backdrop" onclick="closePaletteOnBackdrop(event)">
    <div class="command-palette">
      <div class="search-container">
        <input type="text" id="searchInput" class="search-input" placeholder="ابحث عن بحر، قافية، أو تعديل..." oninput="filterCommands()" autofocus>
        <span class="search-shortcut">ESC</span>
      </div>
      <ul class="palette-results" id="paletteResults">
        <li class="palette-item active" onclick="runCommand('rhyme')">
          <div class="palette-item-text">
            <span class="palette-item-title">البحث عن قافية</span>
            <span class="palette-item-desc">مطابقة الروي وحركة الحروف في الأبيات</span>
          </div>
          <span class="palette-item-shortcut">Ctrl+R</span>
        </li>
        <li class="palette-item" onclick="runCommand('meter')">
          <div class="palette-item-text">
            <span class="palette-item-title">تحليل البحر والوزن العروضي</span>
            <span class="palette-item-desc">التحقق من تفعيلات الشطر والوقوف على الزحافات</span>
          </div>
          <span class="palette-item-shortcut">Ctrl+M</span>
        </li>
        <li class="palette-item" onclick="runCommand('parallels')">
          <div class="palette-item-text">
            <span class="palette-item-title">مراجعة السرقات والتوارد</span>
            <span class="palette-item-desc">البحث عن توافقات في بحور التراث الشعري</span>
          </div>
          <span class="palette-item-shortcut">Ctrl+P</span>
        </li>
        <li class="palette-item" onclick="runCommand('synonyms')">
          <div class="palette-item-text">
            <span class="palette-item-title">اقتراح مرادفات فصيحة</span>
            <span class="palette-item-desc">البحث عن مرادفات تتطابق مع الوزن الحالي</span>
          </div>
          <span class="palette-item-shortcut">Ctrl+S</span>
        </li>
      </ul>
    </div>
  </div>

  <script>
    function toggleTheme() {
      document.body.classList.toggle('dark-mode');
    }

    function openPalette() {
      document.getElementById('backdrop').classList.add('open');
      document.getElementById('searchInput').focus();
    }

    function closePalette() {
      document.getElementById('backdrop').classList.remove('open');
    }

    function closePaletteOnBackdrop(e) {
      if (e.target.id === 'backdrop') {
        closePalette();
      }
    }

    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
      if (e.key === 'Escape') {
        closePalette();
      }
    });

    function filterCommands() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const items = document.querySelectorAll('.palette-item');
      items.forEach(item => {
        const title = item.querySelector('.palette-item-title').textContent.toLowerCase();
        const desc = item.querySelector('.palette-item-desc').textContent.toLowerCase();
        if (title.includes(q) || desc.includes(q)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    }

    function runCommand(action) {
      console.log('Command executed:', action);
      closePalette();
    }
  </script>
</body>
</html>
```

---

## 7. FORBIDDEN LIST (المحرمات الثمانية)

1.  **Never use sparkle icons (✨)** or traditional chatbot bubbles to represent AI.
2.  **Never simulate live typewriter effects** for AI output; recommendations appear via *Midad Bleed*.
3.  **Never use rounded, pill-shaped buttons** or high-radius borders; all corners remain sharp (90 degrees).
4.  **Never apply synthetic neon colors or digital gradients**; the palette resides strictly within natural ink, graphite, and paper tones.
5.  **Never use toast notifications or popup modals** that interrupt the physical workspace during a writing flow.
6.  **Never hide structural parameters**; the rhythmic division lines (*mistarah*) must always remain as the visual foundation.
7.  **Never prioritize Latin typographic hierarchy** over Arabic font sizes or script logic.
8.  **Never require cloud connection warning displays**; the system is local-first, and network notifications are strictly prohibited in the layout.
