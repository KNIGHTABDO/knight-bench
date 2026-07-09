# KNIGHT-BENCH v1

Personal, reproducible benchmark suite for frontier models against real workloads: agentic coding, French/EDN medical reasoning, RTL/Arabic engineering, design taste, medical RAG, streaming infra, agent orchestration, long-context, and cost-efficiency.

**Owner:** Knight (@jip7e) · **Version:** 1.0 · **Created:** 2026-07-09
**Models under test (v1):** Claude Fable 5, GPT-5.6, Gemini 3.5 Flash, Grok 4.5, GLM 5.2, Muse Spark, + any future release.

---

## 0. Fairness Rules (apply to every run, no exceptions)

1. **Temperature:** 0.7 for design/creative tasks (Cat 4), 0.2 for everything else. If a provider doesn't expose temperature, note it in the run log and flag the result with `†`.
2. **System prompt:** identical across models, exactly this and nothing else:
   > `You are an expert assistant. Answer the task exactly as specified. If a format is required, follow it precisely. If you are uncertain about a factual claim, say so explicitly rather than guessing.`
3. **One attempt, no retries.** If the model errors out (API failure, not model failure), retry the *call* but never edit the prompt.
4. **No tools unless the task grants them.** Web search OFF for all tasks (medical tasks especially — you're testing parametric knowledge + honesty, not search).
5. **Same context:** paste the exact prompt text from this document. No paraphrasing, no added context, no "please".
6. **Max output tokens:** set to 8,000 for all tasks except 9.x (which specify their own budgets) and 4.3 / 1.1 (set 16,000).
7. **Record per run:** model + version string, date, input tokens, output tokens, latency (time to last token), cost in USD at list price, raw output saved to `runs/{model}/{task-id}.md`.
8. **Blind judging where possible:** strip model names from outputs before scoring subjective tasks (Cat 4, 7). Rename files to random IDs, score, then de-anonymize.
9. **New model onboarding:** run all 27 tasks in one session, same day, to avoid drift in your own judging mood.

---

## Category 1 — Agentic Coding (weight: 20%)

**What's being measured:** does the model explore and plan before writing code, respect constraints, and produce working diffs — or does it hallucinate file structure and vomit code immediately?

---

### Task 1.1 — Multi-file feature in a Next.js repo

**Prompt (copy-paste):**

```
You are working in a Next.js 15 App Router repository with this structure:

app/
  layout.tsx          (root layout, imports globals.css, wraps children in <Providers>)
  page.tsx            (home page, server component, fetches from lib/db.ts)
  watch/[id]/page.tsx (player page, client component, uses hooks/usePlayer.ts)
components/
  Player.tsx          (video element wrapper, props: src, subtitles, onProgress)
  ProfileSwitcher.tsx (renders profile avatars, reads from lib/profiles.ts)
lib/
  db.ts               (SQLite via better-sqlite3, exports getTitles(), getTitle(id))
  profiles.ts         (exports getProfiles(), setActiveProfile(id) — currently localStorage-backed)
hooks/
  usePlayer.ts        (manages play state, progress, exposes { progress, seek, play, pause })

FEATURE REQUEST: Add per-profile "Continue Watching" functionality:
- Progress must be saved per profile, per title, throttled to at most one write every 5 seconds.
- Storage must be IndexedDB (not localStorage), with a schema you design.
- The home page must show a "Continue Watching" row (client component island inside the server page) sorted by most recently watched, hiding titles with >95% progress.
- Switching profiles must swap the row's contents without a full page reload.
- No new dependencies. No breaking changes to existing exports.

BEFORE writing any code, output a section titled "PLAN" that: (a) lists every file you will create or modify and why, (b) identifies at least two ambiguities or risks in the request and states your resolution, (c) describes the IndexedDB schema. THEN output the full contents of every new/modified file, each in its own fenced code block labeled with its path. Do not omit or abbreviate any file you touch.
```

**Scoring rubric (0–10):**
- **0–2:** No plan section, or plan is a restatement of the request. Code references files/exports that don't exist in the given structure. Adds dependencies.
- **3–4:** Plan exists but is superficial (no risks identified). Code mostly plausible but has a breaking change (modified existing export signature) or uses localStorage anyway.
- **5–6:** Real plan with schema and ≥1 genuine risk. Code is coherent, IndexedDB used, but throttling is naive (setTimeout leak, or writes on every progress tick), or server/client boundary is wrong (IndexedDB accessed in a server component).
- **7–8:** All constraints met. Throttle correct (trailing write on unmount/pause). Client island pattern correct. Profile switch triggers re-query without reload (event, context, or store). Minor nits only (e.g., no error handling on IDB open).
- **9–10:** Everything above, plus: handles the "unload mid-throttle-window loses progress" edge, versioned IDB schema with upgrade path, and the plan's ambiguity analysis catches something you didn't (e.g., what happens to progress when a profile is deleted).

**Auto-checks (pass/fail):**
- [ ] Output contains a `PLAN` section *before* any code block
- [ ] Zero occurrences of `localStorage` in new progress-storage code
- [ ] `import` statements only reference files that exist in the given tree or new files it declared in the plan
- [ ] No `package.json` changes / no new imports from packages not already implied (react, next)
- [ ] Every file it says it modifies appears as a full fenced block
- [ ] TypeScript compiles when dropped into a scaffold (`npx tsc --noEmit` with stub files)

**Estimated tokens:** ~700 in / ~4,000–6,000 out

---

### Task 1.2 — Debugging a broken HLS pipeline from logs

**Prompt (copy-paste):**

```
A streaming app (Next.js frontend, Cloudflare Worker proxy, Real-Debrid backend) has broken video playback on iOS Safari only. Chrome desktop works. Below are the artifacts. Diagnose the root cause(s), rank them by likelihood, and propose the minimal fix. Do NOT rewrite the whole pipeline.

--- Worker snippet (proxy for HLS) ---
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get("u");
    const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
    const h = new Headers(upstream.headers);
    h.set("Access-Control-Allow-Origin", "*");
    h.delete("content-length");
    return new Response(upstream.body, { status: 200, headers: h });
  }
}

--- Frontend (player init) ---
const video = document.querySelector("video");
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(proxied(masterUrl));
  hls.attachMedia(video);
} else {
  video.src = masterUrl; // fallback
}

--- iOS Safari console/log excerpts ---
[Error] Failed to load resource: Plug-in handled load (segment_0001.ts)
[Log] video readyState: 0
[Log] video error: MEDIA_ERR_SRC_NOT_SUPPORTED
[Network] GET https://cdn.rd-host.example/video/master.m3u8 — 200, content-type: application/octet-stream
[Network] GET https://cdn.rd-host.example/video/segment_0001.ts — 200 (expected 206), content-type: application/octet-stream

--- Real-Debrid note ---
The unrestricted link is a direct MP4 for some titles and an HLS master for others; the app always treats it as HLS.

List every distinct bug you find. For each: symptom → cause → one-paragraph fix (code diff ≤ 15 lines). Rank by which one breaks iOS first.
```

**Scoring rubric (0–10):**
- **0–2:** Blames hls.js versions or suggests "try a different player" without engaging the logs. Misses that iOS Safari uses native HLS (Hls.isSupported() is false there).
- **3–4:** Finds one real bug (e.g., the fallback bypasses the proxy) but misses the Range/206 destruction or the content-type problem.
- **5–6:** Finds 2–3 of the real bugs with plausible fixes but sloppy ranking or fixes that break Chrome.
- **7–8:** Finds all core bugs: (1) fallback path sets `video.src = masterUrl` un-proxied → CORS/mixed handling differs, (2) Worker forces `status: 200` and strips content-length, destroying byte-range (206) responses that native HLS on iOS requires, (3) wrong content-type (`application/octet-stream` instead of `application/vnd.apple.mpegurl` / `video/mp2t`) which iOS native HLS rejects, (4) MP4-vs-HLS links always treated as HLS. Fixes are minimal diffs.
- **9–10:** All of the above plus correctly identifies the *first* failure on iOS (native path + wrong content-type on the manifest kills it before segments matter), notes empty-string Range header is itself a bug, and mentions CORS preflight implications of Range on iOS.

**Auto-checks:**
- [ ] Explicitly states that iOS Safari does not use hls.js / uses native HLS
- [ ] Mentions preserving upstream status (206) or Range handling
- [ ] Mentions content-type correction for `.m3u8` and/or `.ts`
- [ ] Each fix ≤ 15 lines of diff as instructed
- [ ] Does not propose a full rewrite

**Estimated tokens:** ~800 in / ~1,500–2,500 out

---

### Task 1.3 — Refactoring under hard constraints

**Prompt (copy-paste):**

```
Refactor the following React component. HARD CONSTRAINTS — violating any single one is a failure:
1. Final component must be under 120 lines (count them).
2. No new files: everything stays in this one file.
3. No new dependencies (React only; no lodash, no zustand).
4. Public API (props) must not change.
5. The three setInterval timers must be consolidated into exactly one.
6. All state updates during unmount must be impossible (no "setState on unmounted component").
7. Preserve the exact rendered DOM structure (same elements, classes, order).
8. Add a line-count comment at the top: // LINES: <n>

function LiveDashboard({ streamId, refreshMs = 5000, onError }) {
  const [viewers, setViewers] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [health, setHealth] = useState("unknown");
  const [log, setLog] = useState([]);
  useEffect(() => {
    const t1 = setInterval(async () => {
      try { const r = await fetch(`/api/streams/${streamId}/viewers`); const j = await r.json(); setViewers(j.count); }
      catch (e) { onError && onError(e); }
    }, refreshMs);
    return () => clearInterval(t1);
  }, [streamId]);
  useEffect(() => {
    const t2 = setInterval(async () => {
      try { const r = await fetch(`/api/streams/${streamId}/bitrate`); const j = await r.json(); setBitrate(j.kbps); setLog(l => [...l, `bitrate ${j.kbps}`]); }
      catch (e) { onError && onError(e); }
    }, refreshMs);
    return () => clearInterval(t2);
  }, [streamId]);
  useEffect(() => {
    const t3 = setInterval(async () => {
      try { const r = await fetch(`/api/streams/${streamId}/health`); const j = await r.json(); setHealth(j.status); if (j.status === "critical") setLog(l => [...l, "CRITICAL"]); }
      catch (e) { onError && onError(e); }
    }, refreshMs);
    return () => clearInterval(t3);
  }, [streamId]);
  return (
    <div className="dashboard dark">
      <div className="stat viewers">{viewers}</div>
      <div className="stat bitrate">{bitrate} kbps</div>
      <div className={`stat health ${health}`}>{health}</div>
      <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

Before the code, list which constraints are in tension and how you resolved them. Then output the final file, then a self-audit table: constraint # → met? → evidence (line numbers or explanation).
```

**Scoring rubric (0–10):**
- **0–2:** Violates ≥2 hard constraints (changes props, adds files/deps, keeps multiple intervals).
- **3–4:** One constraint violated (commonly: forgets `refreshMs` in effect deps or misses the unmount-safety guarantee — an in-flight fetch resolving after cleanup still calls setState).
- **5–6:** All constraints technically met, but unmount safety is a naive `isMounted` boolean without AbortController, or the self-audit is hand-wavy.
- **7–8:** Single interval firing all three fetches (Promise.allSettled or sequential), AbortController tied to cleanup, deps array correct (`streamId`, `refreshMs`, `onError` handled via ref or dep), audit table accurate, LINES comment matches actual count.
- **9–10:** Above, plus notices the pre-existing bug it inherited (`refreshMs` missing from original deps) and calls it out; handles the "onError identity changes every render" trap with a ref; DOM structure byte-identical.

**Auto-checks:**
- [ ] Exactly one `setInterval` in output
- [ ] Line count ≤ 120 and matches the `// LINES:` comment (script: count lines, compare)
- [ ] `AbortController` or equivalent unmount-safety present
- [ ] Props signature unchanged (string match on destructure)
- [ ] JSX return block string-identical modulo whitespace
- [ ] Self-audit table present with all 8 constraints

**Estimated tokens:** ~900 in / ~1,500–2,500 out

---

## Category 2 — Medical Reasoning, French/EDN (weight: 20%)

**What's being measured:** clinical accuracy in French, correct terminology (the terminology *is* the exam), showing work with units, and — critically — refusing to bluff. **Every task in this category requires your manual verification against your collèges/HAS references before a score is final. Reference answers below are starting points, not ground truth — re-verify them yourself, guidelines move.**

---

### Task 2.1 — Dossier progressif (SCA ST+)

**Prompt (copy-paste):**

```
Tu es évalué sur un dossier progressif de type EDN. Réponds en français, avec la terminologie médicale française exacte. Réponds à chaque question dans l'ordre, de façon concise mais complète. Si tu n'es pas certain d'une réponse, dis-le explicitement.

ÉNONCÉ : Un homme de 58 ans, tabagique actif (40 PA), hypertendu sous périndopril, consulte aux urgences à 6h du matin pour une douleur thoracique rétrosternale constrictive apparue brutalement à 4h30, irradiant vers la mâchoire et le bras gauche, non soulagée par le repos, accompagnée de sueurs et de nausées. TA 145/90 mmHg symétrique, FC 92/min, SpO2 97% en air ambiant, auscultation cardiopulmonaire normale, pas de signe d'insuffisance cardiaque.

Q1. Quel diagnostic évoquez-vous en priorité ? Citez les 3 arguments cliniques les plus forts.
Q2. Quel examen réalisez-vous en première intention, dans quel délai, et que recherchez-vous précisément ?
Q3. L'ECG montre un sus-décalage du segment ST de 3 mm en V1-V4 avec miroir en inférieur. Quel est le diagnostic précis et l'artère probablement occluse ?
Q4. Le centre de coronarographie le plus proche est à 45 minutes de transfert. Quelle stratégie de reperfusion choisissez-vous et pourquoi ? Citez le délai-seuil qui guide cette décision.
Q5. Détaillez le traitement médicamenteux à instaurer immédiatement aux urgences (classes, exemples de molécules), avant le transfert.
Q6. Citez 3 complications précoces (< 48h) à surveiller.
```

**Reference answers (verify against your course refs before scoring):**
- Q1: Syndrome coronarien aigu (SCA) — infarctus du myocarde. Arguments: douleur rétrosternale constrictive typique avec irradiations (mâchoire/bras gauche), durée prolongée non soulagée par le repos, terrain (tabac, HTA, homme >55 ans) + signes neurovégétatifs.
- Q2: ECG 18 dérivations dans les 10 minutes suivant le premier contact médical; recherche de sus-décalage de ST (≥1 mm dans 2 dérivations contiguës frontales, ≥2 mm en précordiales), miroir, ondes Q, BBG récent.
- Q3: SCA ST+ (STEMI) antérieur / antéroseptal → artère interventriculaire antérieure (IVA).
- Q4: Angioplastie primaire (ICP primaire) car délai premier contact médical → passage du guide estimable ≤ 120 min (seuil décisionnel: 120 min; si >120 min, fibrinolyse si délai symptômes <12h et pas de contre-indication).
- Q5: Double antiagrégation — aspirine (250 mg IV ou 150–300 mg PO) + inhibiteur P2Y12 (si ICP primaire: prasugrel ou ticagrélor); anticoagulation (HNF ou énoxaparine); antalgiques (titration morphine si besoin); dérivés nitrés seulement si poussée hypertensive/OAP (prudence si IDM inférieur/VD); O2 seulement si SpO2 <90%.
- Q6: Troubles du rythme ventriculaire (FV/TV), insuffisance cardiaque/choc cardiogénique, troubles de conduction (BAV), complications mécaniques (rupture septale, IM aiguë), péricardite précoce, récidive ischémique.

**Scoring rubric (0–10):**
- **0–2:** Wrong diagnosis, or answers in English, or invents delays/thresholds (e.g., "90 minutes" stated as the French threshold without caveat).
- **3–4:** Diagnosis correct but reperfusion logic wrong (chooses fibrinolysis despite 45-min transfer) or omits the 120-min threshold; terminology anglicized ("STEMI" used with no French equivalent given).
- **5–6:** Q1–Q4 correct; Q5 incomplete (misses anticoagulation, or recommends clopidogrel as first choice pre-ICP without nuance) or units/doses invented confidently.
- **7–8:** All questions substantively correct, correct French terms (sus-décalage, IVA, ICP primaire, double antiagrégation plaquettaire), 120-min threshold explicit, O2-only-if-hypoxic nuance present.
- **9–10:** Above, plus fine touches: 18-lead ECG (V3R-V4R, V7-V9), "premier contact médical" framing for delays, contraindication awareness for nitrés, and explicit uncertainty flags where doses vary by source.
- **Bluff penalty:** −2 any time a specific number (dose, threshold) is stated confidently and is wrong. **Honesty credit:** no penalty for "je ne suis pas certain de la dose exacte" if the class/strategy is right.

**Auto-checks:**
- [ ] Response entirely in French
- [ ] Contains "120" in Q4 (threshold)
- [ ] Contains "IVA" or "interventriculaire antérieure" in Q3
- [ ] ECG delay "10 minutes" in Q2

**Estimated tokens:** ~600 in / ~1,200–2,000 out

---

### Task 2.2 — Clinical calculation (Cockcroft + dose adaptation)

**Prompt (copy-paste):**

```
Réponds en français. Montre TOUS tes calculs, étape par étape, avec les unités à chaque ligne. Donne la formule avant de l'appliquer. Si une valeur ou un seuil te semble incertain, signale-le.

Patiente de 78 ans, 60 kg, hospitalisée pour une embolie pulmonaire non grave. Créatininémie : 130 µmol/L.

Q1. Calcule la clairance de la créatinine selon la formule de Cockcroft et Gault. Donne le résultat arrondi à une décimale, avec son unité.
Q2. Interprète ce résultat (stade d'insuffisance rénale).
Q3. Une HBPM à dose curative (ex : énoxaparine) est-elle utilisable chez cette patiente ? Justifie avec le seuil de clairance applicable et propose l'alternative si nécessaire.
Q4. Quelle surveillance biologique spécifique proposes-tu pour l'anticoagulant retenu ?
```

**Reference answer (verify):**
- Q1: Cockcroft-Gault (femme): Cl = [(140 − âge) × poids × 1,04] / créatininémie (µmol/L) = (140−78) × 60 × 1,04 / 130 = 62 × 60 × 1,04 / 130 = 3 868,8 / 130 ≈ **29,8 mL/min**.
- Q2: Insuffisance rénale sévère (Cl < 30 mL/min).
- Q3: HBPM à dose curative contre-indiquée si Cl < 30 mL/min → HNF (héparine non fractionnée) à la seringue électrique, relais selon contexte. (Certains référentiels: seuil 30 mL/min strict pour dose curative; prophylaxie = seuil 20–30 selon molécule — accept nuance.)
- Q4: HNF: TCA (ou activité anti-Xa selon protocole) + surveillance plaquettaire (TIH) 2×/semaine.

**Scoring rubric (0–10):**
- **0–2:** Wrong formula, or uses mg/dL coefficient with µmol/L value, or result off by >20% with no unit tracking.
- **3–4:** Formula right, arithmetic wrong, OR result right but no step-by-step work shown (instruction violation), OR concludes HBPM is fine at 29,8 mL/min.
- **5–6:** Calculation correct (~29,8 mL/min, accept 29–31 from rounding of k), interpretation correct, but Q3 justification muddles curative vs prophylactic thresholds, or Q4 misses TIH monitoring.
- **7–8:** All four correct, units on every line, correct coefficient (1,04 femme / µmol/L stated), threshold <30 explicit, HNF alternative, TCA/anti-Xa + plaquettes.
- **9–10:** Above + acknowledges Cockcroft's limits in the elderly (surestimation/sous-estimation, poids), mentions that some sources use k=1.03/1.05 and flags it, notes fondaparinux is also CI <30.
- **Bluff penalty:** −2 for a confidently wrong threshold or coefficient.

**Auto-checks:**
- [ ] Final Q1 value in [29.0, 31.0] mL/min with unit
- [ ] Formula written before substitution
- [ ] Contains "30" as the curative HBPM threshold
- [ ] Every calculation line carries units

**Estimated tokens:** ~350 in / ~600–1,000 out

---

### Task 2.3 — Trap question (plausible answer is wrong per HAS/SPILF)

**Prompt (copy-paste):**

```
Réponds en français, de façon concise. Question d'internat :

Une femme de 24 ans, sans antécédent, sans fièvre, sans douleur lombaire, consulte pour brûlures mictionnelles et pollakiurie depuis 24 heures. La bandelette urinaire est positive (leucocytes +, nitrites +). Il s'agit d'une cystite aiguë simple.

Q1. Quel est l'antibiotique de première intention recommandé en France, avec sa posologie et sa durée ?
Q2. Un ECBU est-il indiqué ? Justifie.
Q3. Pourquoi les fluoroquinolones (ex : ciprofloxacine) ne sont-elles PAS recommandées en première intention ici, alors qu'elles sont efficaces ?
```

**Reference answer (verify against current SPILF/HAS — this moves):**
- Q1: **Fosfomycine-trométamol 3 g en dose unique** (première intention). (Deuxième intention: pivmécillinam 400 mg ×2/j, 3–5 jours selon référentiel.)
- Q2: **Non** — pas d'ECBU dans la cystite aiguë simple; BU suffit. ECBU si échec, récidive précoce, ou cystite à risque de complication.
- Q3: Épargne des fluoroquinolones: pression de sélection/résistances, effets indésirables (tendinopathies, etc.), et efficacité de la fosfomycine en dose unique — les FQ sont réservées à d'autres situations (pyélonéphrite, IU masculine selon contexte).

**The trap:** models trained heavily on US data answer nitrofurantoïne or TMP-SMX first-line, or reflexively order an ECBU, or recommend amoxicilline. Any of those is the trap sprung.

**Scoring rubric (0–10):**
- **0–2:** First-line answer is a fluoroquinolone, amoxicilline, or TMP-SMX presented as the French recommendation.
- **3–4:** Answers nitrofurantoïne first-line (defensible in other countries, wrong for French first-line) without flagging guideline uncertainty; or orders ECBU systematically.
- **5–6:** Fosfomycine correct but posology/durée wrong or omitted, or Q2 hedged into "oui parfois" without the clean "non, BU suffit".
- **7–8:** All three correct: fosfomycine 3 g dose unique, pas d'ECBU (avec exceptions correctes), antibiotic-stewardship rationale for FQ.
- **9–10:** Above + cites second-line (pivmécillinam), mentions that recommendations are SPILF/HAS and can evolve, distinguishes cystite simple vs à risque de complication crisply.
- **Bluff penalty:** −3 here (it's the whole point of the task) for any confidently wrong first-line.

**Auto-checks:**
- [ ] "fosfomycine" present in Q1
- [ ] "dose unique" or "3 g" present
- [ ] Q2 answer is negative (no systematic ECBU)

**Estimated tokens:** ~250 in / ~400–700 out

---

## Category 3 — RTL/Arabic Engineering (weight: 10%)

**What's being measured:** real bidi/typography competence, not "add dir=rtl and pray".

---

### Task 3.1 — Bilingual layout with auto-direction detection

**Prompt (copy-paste):**

```
Build a single-file React component `<BilingualComposer />`: a message-composer UI (textarea + send button + character counter + a preview bubble above it) for an app whose users freely mix Arabic and French, sometimes in the same message.

Requirements:
1. Direction must be detected PER MESSAGE from content, not from a global locale. Implement first-strong-character bidi detection yourself (Unicode ranges for Arabic: 0600–06FF, 0750–077F, 08A0–08FF, FB50–FDFF, FE70–FEFF). Neutral-only content (numbers, punctuation) falls back to the app default (prop `fallbackDir`).
2. The preview bubble must render mixed content correctly: an Arabic sentence containing a Latin product name like "Next.js 15" must not visually scramble the "15". Explain in a comment which CSS/bidi mechanism you rely on (unicode-bidi, dir=auto, isolation) and why.
3. The layout chrome (send button position, counter position) mirrors with direction: button on the left in RTL, right in LTR — using CSS logical properties (inline-start/end), zero left/right physical properties.
4. Textarea alignment and caret must follow detected direction live, as the user types.
5. No dependencies beyond React. No Tailwind. Plain CSS-in-file.

Output: one complete file. Then a "BIDI NOTES" section: 3 concrete failure modes of naive dir handling that your implementation avoids.
```

**Scoring rubric (0–10):**
- **0–2:** Uses `text-align: right` as the RTL strategy; no detection logic; physical left/right everywhere.
- **3–4:** Detection exists but is regex-naive (only 0600–06FF), or direction set globally on the container so the button doesn't mirror, or mixed-content problem ignored.
- **5–6:** First-strong detection correct, logical properties mostly used, but preview relies on `dir` alone without bidi isolation for embedded LTR runs, or live caret behavior not handled (detection only on submit).
- **7–8:** All 5 requirements met; uses `dir="auto"` or explicit first-strong result plus `unicode-bidi: plaintext/isolate` appropriately with a correct explanatory comment; zero physical direction properties; BIDI NOTES are real (e.g., punctuation jumping at line ends, neutral-run reordering, percent signs with Arabic numerals).
- **9–10:** Above + handles the neutral-only fallback cleanly, mentions Arabic-Indic vs European digits, and the notes demonstrate the model has actually shipped bidi UI (e.g., placeholder direction vs content direction mismatch).

**Auto-checks:**
- [ ] No occurrences of `left:` / `right:` / `margin-left` / `padding-right` etc. in CSS (grep physical props)
- [ ] Contains at least 3 Arabic Unicode range bounds from the list
- [ ] Contains `unicode-bidi` or `dir="auto"` with an explanatory comment
- [ ] Compiles as JSX

**Estimated tokens:** ~500 in / ~2,000–3,000 out

---

### Task 3.2 — Arabic typography edge cases

**Prompt (copy-paste):**

```
You are reviewing a web app that renders Arabic UI text and user content. For each of the following 6 real-world Arabic typography problems, explain (a) why it happens technically, and (b) the concrete CSS/HTML/font fix. Be specific — name properties, values, and font behaviors. If a "fix" is actually a tradeoff, say so.

1. The word "الله" renders as a special single glyph in some fonts but as separate letters in others, breaking visual consistency across the app.
2. Letter-spacing was added for a "luxury" headline style and the Arabic text shattered into disconnected letters.
3. Numbers inside Arabic sentences sometimes appear as ٠١٢٣ and sometimes as 0123 depending on the user's device.
4. The kasra and shadda diacritics overlap each other on the same letter in the chosen webfont, becoming unreadable at small sizes.
5. An Arabic headline is being truncated with ellipsis; the ellipsis appears on the wrong side and the truncation cuts a connected word mid-ligature, leaving a dangling connection stroke.
6. Bold text (font-weight: 700) is being synthesized by the browser because the Arabic webfont only ships a 400 weight, and the fake bold destroys the letterforms.
```

**Scoring rubric (0–10):**
- **0–2:** Generic answers ("use a better font") for most items; confuses letter-spacing with word-spacing; doesn't know why letter-spacing breaks Arabic (cursive joining).
- **3–4:** 2–3 items technically correct; misses ligature/OpenType explanations (liga/rlig, Allah ligature as a font feature), or digit issue answered without `numeric` locale/`unicode-range`/explicit digit-shaping options.
- **5–6:** 4–5 items solid. Knows: letter-spacing must be 0 for Arabic (joining), font-synthesis: none for #6, direction-aware truncation for #5.
- **7–8:** All 6 correct with real mechanisms: OpenType features (rlig, liga, calt) for #1/#5; `letter-spacing: 0` + suggests tracking via word-spacing or scale instead for #2; digit rendering controlled via font features/locale (`lang` attribute, some fonts map digits) for #3; mark-positioning (GPOS mark/mkmk) and fallback font stacking for #4; `text-overflow` with proper `dir` + accepting that mid-ligature truncation needs JS-side grapheme-aware truncation for #5; `font-synthesis-weight: none` + shipping a real 700 or variable font for #6.
- **9–10:** Above + names specific reliable Arabic webfonts/variable fonts, mentions harfbuzz shaping realities, and flags the tradeoffs honestly (e.g., forcing Eastern vs Western digits is a product decision, not a bug).

**Auto-checks:**
- [ ] Mentions cursive joining/connected script for item 2
- [ ] Mentions `font-synthesis` for item 6
- [ ] Mentions OpenType/ligature feature for item 1 or 5

**Estimated tokens:** ~400 in / ~1,200–2,000 out

---

### Task 3.3 — Quranic text handling

**Prompt (copy-paste):**

```
I am building a Quran reading feature (web, React). Answer as a technical design doc with code snippets where relevant.

1. Explain the difference between Imlaei and Uthmani script text sources, and why naively rendering Uthmani text with a general-purpose Arabic font produces wrong or missing glyphs. What font(s) are designed for this and what's the standard approach (including the page-specific font strategy used by major Quran apps)?
2. Write a JavaScript function `stripDiacritics(verse)` that removes tashkeel/harakat and Quranic annotation marks for SEARCH INDEXING ONLY (the displayed text must keep them). List the exact Unicode ranges/code points you strip and — important — at least two code points you must NOT strip because removing them changes letters, not diacritics (e.g., hamza forms, madda).
3. Verse text must never be broken at arbitrary points: propose a rendering strategy so that (a) a verse-end marker (۝ + number) never wraps onto a line alone, and (b) justification looks like a mushaf (stretched kashida vs spaced words) — state what CSS can and cannot do here today and what the honest fallback is.
4. Storage: I want exact-match search on normalized text but display of full Uthmani text. Propose the SQLite schema (I use FTS5) with the normalization pipeline.
```

**Scoring rubric (0–10):**
- **0–2:** Treats Quranic text as ordinary Arabic; strip function deletes hamza/alef variants (destroying words); no awareness of Uthmani-specific glyphs.
- **3–4:** Knows Uthmani vs Imlaei at a surface level; strip function uses only 064B–065F and misses Quranic annotation ranges (06D6–06ED, 08D3+…) or strips 0670 (superscript alef) without discussing the tradeoff.
- **5–6:** Solid on 1 and 2 (mentions KFGQPC/Amiri Quran/mushaf page fonts and the per-page font approach), weaker on 3 (claims CSS kashida justification works reliably — it doesn't) or 4 (FTS5 schema without contentless/external-content design).
- **7–8:** All four strong: page-specific glyph fonts (QPC/King Fahd Complex model), correct strip ranges with explicit do-not-strip list, honest CSS limits for justification (text-justify support patchy; kashida via U+0640 insertion is hacky; fallback = pre-shaped page layouts or accepting space justification), FTS5 external-content table with a normalize() applied at index time and original text preserved.
- **9–10:** Above + non-breaking strategy for verse markers (word-joiner U+2060 / NBSP binding, or wrapping verse-end in an inline-block with the last word), mentions hafs layout data / pre-segmented page datasets, and warns that normalization for search should also unify alef variants *only* in the index, never display.

**Auto-checks:**
- [ ] `stripDiacritics` present and syntactically valid
- [ ] Mentions Unicode range 06D6–06ED (Quranic annotations) or equivalent code points
- [ ] Explicit "do not strip" list present
- [ ] FTS5 mentioned in schema with normalization at index time

**Estimated tokens:** ~500 in / ~1,800–2,800 out

---

## Category 4 — Frontend Design Taste (weight: 15%)

**What's being measured:** does it produce work in the Active Theory / Unseen / Studio Freight lineage, or default AI slop? Judge blind. **Instant penalties (−2 each, stackable): purple-to-blue gradient hero, emoji in headings, default shadcn look presented as "premium", glassmorphism cards on a generic dark background, "Inter for everything".**

---

### Task 4.1 — Landing page

**Prompt (copy-paste):**

```
Design and build a single-file HTML landing page (inline CSS + JS, no frameworks, no CDN) for "MADAR" — a fictional invite-only Arabic cinema streaming service. Dark, cinematic, editorial. Think film-studio title sequence, not SaaS template.

Hard requirements:
- A hero that treats Arabic typography as the visual centerpiece (the wordmark "مدار" must appear, designed, not just typed).
- A distinct typographic system: display face + text face with clear scale contrast (declare fallback stacks; you may use system fonts creatively since no CDN).
- Motion: at least two scroll-driven or time-driven effects implemented in vanilla JS/CSS that feel choreographed, not decorative confetti.
- A color system that is NOT neutral-gray-plus-accent-purple. Commit to a palette and use it with restraint.
- Fully bidirectional: the page is Arabic-first (RTL) with French secondary text, correctly handled.
- Max 600 lines. Must open and run from a single .html file.

Then append a 5-line DESIGN RATIONALE: what's the concept, what did you deliberately NOT do.
```

**Scoring rubric (0–10):**
- **0–2:** SaaS template with dir=rtl slapped on. Purple gradient. Emoji. Centered-everything hero with a pill button.
- **3–4:** Competent but anonymous: dark bg, glass cards, Inter-alike stack, motion = fade-in-on-scroll everywhere. Arabic typed, not composed.
- **5–6:** A real concept is visible (editorial grid, oversized Arabic display type, intentional palette) but execution is uneven — motion generic, or RTL breaks in one section, or the palette commits then chickens out into gray.
- **7–8:** Cohesive art direction. Arabic wordmark treated as an object (scale, cropping, layering). Motion has choreography (staggering, easing personality, scroll-linked transforms with restraint). Palette confident and unusual. Rationale shows taste (knows what it refused to do).
- **9–10:** You'd screenshot it. Distinct enough that it couldn't have come from a template. Typography, motion, and palette reinforce one idea. RTL is flawless including the French secondary content.

**Auto-checks:**
- [ ] Single file, runs offline, ≤600 lines
- [ ] No external requests (grep http)
- [ ] `dir="rtl"` on root + logical properties in CSS
- [ ] Zero emoji characters in markup
- [ ] DESIGN RATIONALE present, ≤5 lines

**Estimated tokens:** ~450 in / ~5,000–8,000 out

---

### Task 4.2 — Single component

**Prompt (copy-paste):**

```
Build one React component, single file, CSS-in-file, no dependencies beyond React: a "now playing" module for a Quran audio app. It shows: reciter name (Arabic), surah name (Arabic calligraphic emphasis), verse progress, waveform-or-equivalent visualization, play/pause, and a 10-second back control.

Constraints:
- Dark-luxury direction, but NO glassmorphism, NO neon glow, NO gradient borders. Find another way to create depth and hierarchy (light, texture, typography, spacing).
- The visualization must be generative (canvas or SVG driven by fake data you synthesize), animated at 60fps without jank (explain your rAF strategy in a comment).
- RTL layout. Progress must fill right-to-left.
- Interactive states (hover, active, playing vs paused) must be designed, not default.
- Under 250 lines.

Append 3 lines: the single design idea the component is built around.
```

**Scoring rubric (0–10):**
- **0–2:** Violates the explicit bans (glass/glow/gradient-border), or progress fills LTR, or it's a default-looking media player.
- **3–4:** Bans respected but depth strategy is just "darker gray boxes"; visualization is static bars pretending to be a waveform; states are default browser.
- **5–6:** One genuinely good idea (typographic hierarchy, light-based depth, unusual layout) but the rest is filler; rAF present but re-renders React on every frame.
- **7–8:** Coherent restrained design; canvas/SVG animation isolated from React render cycle (refs + rAF, no per-frame setState); RTL progress correct; states feel authored (timing curves, micro-motion).
- **9–10:** The 3-line design idea is sharp and the component visibly executes it; someone could identify the aesthetic as intentional; performance strategy comment is correct and real.

**Auto-checks:**
- [ ] No `backdrop-filter`, no `box-shadow` with colored glow values, no gradient border patterns (grep)
- [ ] `requestAnimationFrame` present; no `setState`/state-setter inside the rAF loop
- [ ] ≤250 lines
- [ ] Progress direction: fill anchored to inline-start in RTL context or explicit right-anchor

**Estimated tokens:** ~400 in / ~2,500–4,000 out

---

### Task 4.3 — Full visual system

**Prompt (copy-paste):**

```
Define a complete visual identity system, as a markdown spec + design tokens (JSON) + one demonstration screen (single-file HTML), for "SIRAJ" — a fictional local-first AI writing tool for Arabic poets and essayists. Positioning: a quiet, serious instrument. Anti-references: anything resembling a generic AI chat app.

Deliverables, in order:
1. CONCEPT (max 120 words): one governing idea. Not vibes — an idea with consequences.
2. TYPOGRAPHY: Arabic-first pairing strategy (display/text/UI), scale (numeric), rules for Latin embedded in Arabic text.
3. COLOR: full palette with hex, semantic token names, dark + light modes, with stated ratios/contrast intent. The palette must be derivable from the concept.
4. MOTION: principles (durations, easings as cubic-bezier values, what NEVER animates), 3 named signature moves.
5. TOKENS: a design-tokens JSON block (color, type, space, radius, motion) consistent with the above.
6. DEMO: one screen (the writing canvas with a command palette open), single-file HTML, ≤400 lines, using ONLY the tokens you defined.
7. FORBIDDEN LIST: 8 things this brand never does.

The demo must visibly instantiate the concept — if the concept says "ink", I should see the consequence, not read about it.
```

**Scoring rubric (0–10):**
- **0–2:** Concept is adjectives ("elegant, modern, clean"). Tokens don't match the demo. Purple appears.
- **3–4:** Serviceable system but interchangeable with any AI tool brand; motion section is generic ("subtle transitions, 200ms ease"); demo is a chat UI wearing a hat.
- **5–6:** Real concept with some consequences visible; tokens internally consistent; demo decent but the command palette is stock; forbidden list is padding ("no Comic Sans").
- **7–8:** Concept → consequences traceable in type, color, AND motion; easings are opinionated and named; demo uses tokens verbatim (auditable); forbidden list shows actual taste (bans things that are tempting, not strawmen).
- **9–10:** The system feels like it came from a studio. Arabic typography strategy is expert (embedded Latin rules, scale logic for Arabic x-height equivalents). Demo screen is screenshot-worthy and clearly NOT a chat app.

**Auto-checks:**
- [ ] Concept ≤120 words
- [ ] JSON tokens block parses
- [ ] Every hex color in the demo CSS exists in the tokens JSON (script: extract + diff)
- [ ] Demo ≤400 lines, single file, offline
- [ ] Forbidden list has exactly 8 items

**Estimated tokens:** ~500 in / ~6,000–9,000 out

---

## Category 5 — Medical RAG / Retrieval (weight: 15%)

**What's being measured:** retrieval engineering competence on YOUR actual stack (SQLite FTS5, BM25, French medical corpora) — not vector-DB blog regurgitation.

---

### Task 5.1 — Multi-hop retrieval pipeline over SQLite FTS5

**Prompt (copy-paste):**

```
Design a multi-hop retrieval pipeline for a French medical Q&A assistant (EDN exam prep). Constraints: SQLite FTS5 with BM25 only — no embeddings, no external services, must run in a Cloudflare Worker or local process with <200ms retrieval budget per hop, corpus = ~40k chunks from French medical collèges (structured: item number, specialty, section headers, chunk text).

The failure you must solve: single-shot BM25 fails on questions like "Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?" — because the answer requires first resolving what the complication IS (hop 1), then retrieving its management (hop 2).

Deliver:
1. Pipeline architecture: stages, what each hop's query is built from, stopping criteria, max hops.
2. Query reformulation strategy WITHOUT an LLM in the loop for hop 1 (pure lexical/structural techniques) AND a variant WITH a small LLM reformulator — compare cost/latency.
3. The exact SQLite schema (FTS5 virtual table + supporting tables) including how you exploit item/specialty/section metadata for filtered hops.
4. Concrete SQL for one worked example (the "complication" question above, invent plausible chunk data), showing hop-1 query, extraction of the bridge entity, hop-2 query.
5. Failure modes of your own design: list 3 and mitigation for each.
```

**Scoring rubric (0–10):**
- **0–2:** Recommends embeddings/pgvector despite constraints; no actual SQL; "multi-hop" means running the same query twice.
- **3–4:** Reasonable architecture but the bridge-entity extraction is hand-waved ("parse the answer"), or FTS5 syntax errors (wrong MATCH usage, misuse of bm25()), or metadata unused.
- **5–6:** Working schema and plausible SQL; hop-2 query built from hop-1 results via candidate term extraction; but stopping criteria vague or the no-LLM reformulation is weak (just keyword AND).
- **7–8:** Sound end-to-end: FTS5 external content or contentless table done right, bm25() with column weights (title/section boosted), no-LLM hop-1 via structural priors (section headers like "Complications" + proximity/NEAR queries + noun-phrase candidate extraction), LLM variant compared honestly on latency/cost, filtered hops via item/specialty joins, real failure modes (bridge entity ambiguity, vocabulary mismatch, hop drift).
- **9–10:** Above + French-specific touches (see 5.2 overlaps: accent folding at tokenizer level, abbreviation expansion table joined into query building), a reranking step within budget, and stopping criteria that are measurable (score deltas, coverage of question terms).

**Auto-checks:**
- [ ] Contains `CREATE VIRTUAL TABLE` with `fts5`
- [ ] Uses `bm25(` with weights or ORDER BY rank
- [ ] Two-hop worked example with distinct hop-1 and hop-2 queries
- [ ] No embedding/vector solution proposed

**Estimated tokens:** ~550 in / ~2,500–4,000 out

---

### Task 5.2 — BM25 tuning code for medical French

**Prompt (copy-paste):**

```
Write production-quality code (TypeScript or Python, your choice, runnable, with tests) that improves BM25 retrieval quality over SQLite FTS5 for MEDICAL FRENCH text. It must handle:

1. Accent/diacritic folding so "oedème"/"œdème"/"oedeme" all match — implemented at the right layer (explain: tokenizer config vs query-time normalization vs index-time normalization, and pick one with justification; show the FTS5 tokenizer configuration you'd use, e.g. unicode61 remove_diacritics options, and its limits for œ/æ ligatures).
2. Medical abbreviation expansion at query time: "IDM" → infarctus du myocarde, "BPCO", "AVC", "HTA", "IRC", "FA", "EP", "SCA", "OAP", "MTEV" — as a data-driven table (provide it), with a strategy for ambiguous abbreviations (e.g., "IRC" = insuffisance rénale chronique vs... what else? handle ambiguity explicitly, don't pretend it away).
3. Query building that combines: exact phrase boost, expanded-abbreviation OR-groups, and per-column BM25 weights (title=3.0, section=2.0, body=1.0).
4. A test suite with ≥8 cases proving: accent variants match, abbreviations expand, phrase boost changes ranking, ambiguous abbreviation produces both expansions.

No external search libraries — SQLite (better-sqlite3 or sqlite3) only.
```

**Scoring rubric (0–10):**
- **0–2:** Uses an external search lib; normalization applied only at query time while index keeps accents (mismatch = zero results); code doesn't run.
- **3–4:** Right idea, wrong layer (normalizes queries but never addresses index side), or unicode61 mentioned without `remove_diacritics 2` vs ligature caveat, or abbreviation table hardcoded into regex spaghetti.
- **5–6:** Working code, correct tokenizer config, abbreviation expansion works, but ambiguity is "picks the first one", tests thin (<8 or asserting nothing meaningful).
- **7–8:** Correct layered design (index-time normalization column or tokenizer + matching query-time normalization; œ→oe handled explicitly since unicode61 won't fold ligatures), data-driven abbreviation table with multi-expansion OR groups, FTS5 query syntax valid (quoted phrases, NEAR, column filters), 8+ real tests.
- **9–10:** Above + French-specific extras: elision handling (l'œdème), hyphenated terms (anti-coagulant), sigle detection heuristic (all-caps 2–5 letters) rather than exact-match-only, and honest notes on what BM25 still can't fix (synonymy: "crise cardiaque" ↔ IDM).

**Auto-checks:**
- [ ] Code runs (execute in container), tests pass
- [ ] `remove_diacritics` appears in tokenizer config discussion/code
- [ ] œ/oe handling explicit
- [ ] ≥8 test cases
- [ ] "IRC" produces ≥2 expansions in tests

**Estimated tokens:** ~500 in / ~3,000–4,500 out

---

### Task 5.3 — Catching a hallucinated citation with tiered attribution

**Prompt (copy-paste):**

```
Tu es le module "vérificateur" d'un assistant médical français. On te donne (a) une réponse générée et (b) les chunks réellement récupérés par le système. Ta mission : classer CHAQUE affirmation de la réponse selon une attribution à 3 niveaux :
- [SOURCÉ] : directement soutenue par un chunk (cite l'ID)
- [INFÉRÉ] : déduction raisonnable des chunks mais non explicite (explique l'inférence)
- [NON SOUTENU] : absente des chunks — potentielle hallucination, même si médicalement plausible

Puis produis un verdict global : la réponse est-elle publiable telle quelle ? Sinon, réécris-la en ne gardant que le sourcé/inféré.

--- CHUNKS RÉCUPÉRÉS ---
[C1] (Collège de Cardiologie, item 232) "L'insuffisance cardiaque à fraction d'éjection réduite (IC-FEr) est définie par une FEVG ≤ 40 %. Le traitement repose sur quatre classes : IEC (ou ARNI), bêtabloquants, antagonistes des récepteurs minéralocorticoïdes, et inhibiteurs de SGLT2."
[C2] (Collège de Cardiologie, item 232) "Les bêtabloquants ayant l'AMM dans l'IC-FEr sont : bisoprolol, carvédilol, métoprolol succinate et nébivolol. L'introduction se fait à faible dose avec titration progressive."
[C3] (Collège de Cardiologie, item 232) "La vaccination antigrippale annuelle est recommandée chez les patients insuffisants cardiaques."

--- RÉPONSE GÉNÉRÉE À VÉRIFIER ---
"Le traitement de l'IC-FEr repose sur quatre piliers : IEC ou ARNI, bêtabloquants (par exemple bisoprolol, à débuter à 1,25 mg/j), antagonistes des récepteurs minéralocorticoïdes et iSGLT2. La FEVG seuil est ≤ 40 %. L'ivabradine est indiquée en première intention si la FC reste > 70/min. La vaccination antigrippale est recommandée, de même que la vaccination antipneumococcique. Une restriction hydrique stricte à moins d'un litre par jour est systématique."
```

**Reference key:**
- Quatre piliers + classes → [SOURCÉ C1]. FEVG ≤40% → [SOURCÉ C1]. Bisoprolol comme exemple → [SOURCÉ C2]; **la dose "1,25 mg/j" → [NON SOUTENU]** (plausible — c'est la vraie dose initiale — mais absente des chunks; c'est le piège central). "Débuter à faible dose" → [INFÉRÉ C2] si formulé sans le chiffre. Ivabradine "première intention" → [NON SOUTENU] (et médicalement faux en première intention — double faute). Vaccination grippale → [SOURCÉ C3]. Antipneumococcique → [NON SOUTENU] (plausible/vrai en pratique, mais pas dans les chunks). Restriction hydrique stricte systématique → [NON SOUTENU] (et cliniquement contestable). Verdict: non publiable telle quelle; réécriture attendue.

**Scoring rubric (0–10):**
- **0–2:** Marks everything SOURCÉ because it's medically plausible — the exact failure the verifier exists to prevent.
- **3–4:** Catches ivabradine but lets the bisoprolol dose slide because "it's correct" — misses that attribution ≠ truth.
- **5–6:** Catches most NON SOUTENU items but conflates INFÉRÉ and SOURCÉ, or verdict says publishable with edits inline instead of the required rewrite.
- **7–8:** All claims correctly tiered including the dose trap (true-but-unsourced flagged), clean rewrite containing only supported content, correct chunk IDs.
- **9–10:** Above + explicitly articulates the principle (a verifier checks support, not plausibility; true-but-unsourced is still a citation failure), and notes ivabradine is doubly wrong (unsourced AND clinically not first-line).

**Auto-checks:**
- [ ] "1,25" flagged as NON SOUTENU
- [ ] Ivabradine flagged as NON SOUTENU
- [ ] Antipneumococcique flagged as NON SOUTENU
- [ ] Rewrite present and contains no unsupported claims (manual scan)

**Estimated tokens:** ~700 in / ~800–1,400 out

---

## Category 6 — Streaming / Media Infra (weight: 5%)

---

### Task 6.1 — Safari-compatible HLS solution

**Prompt (copy-paste):**

```
Design and implement the playback layer for a web streaming app that must work on: iOS Safari (16+), macOS Safari, Chrome/Edge/Firefox desktop, and Android Chrome. Sources are heterogeneous: some are HLS masters (fMP4 or TS segments), some are direct MP4 files with byte-range support, some MKV (which browsers won't play natively).

Deliver:
1. A decision matrix: source type × platform → playback strategy (native HLS, hls.js/MSE, direct progressive, "needs remux/transcode — not playable as-is"). Be honest about MKV.
2. A single TypeScript module `createPlayer(video: HTMLVideoElement, source: SourceInfo)` implementing the matrix, with feature detection done correctly (explain why `Hls.isSupported()` alone is the wrong test on iOS, and the canPlayType nuance).
3. The three iOS-Safari-specific traps you are defending against, with the code line that defends each (examples of trap classes: autoplay policy, inline playback attribute, range/206 requirements, manifest content-type strictness, live-vs-vod edge behavior — pick the three you consider highest-impact and justify).
4. Error recovery: network error mid-playback on hls.js vs native — what signal do you get in each, and what does your module do?
```

**Scoring rubric (0–10):**
- **0–2:** "Just use hls.js everywhere." MKV hand-waved as playable. No iOS specifics.
- **3–4:** Matrix mostly right but feature detection is `Hls.isSupported()` first (wrong order on iOS where MSE may exist but native is correct), or `playsinline` missed.
- **5–6:** Correct detection order (canPlayType 'application/vnd.apple.mpegurl' → native; else MSE/hls.js), MKV honestly marked unplayable without remux; traps decent but code doesn't fully match claims.
- **7–8:** Clean module, correct matrix, three well-chosen traps each with a concrete defending line (`playsinline` + muted autoplay policy, content-type/Range strictness on native pipeline, seeking/duration quirks), error recovery differentiates hls.js events (Hls.Events.ERROR with fatal recovery calls) vs native (video error events + src reload with position restore).
- **9–10:** Above + fMP4-vs-TS nuance (what iOS versions accept), a note on DRM/FairPlay boundary being out of scope but flagged, and position-restoring reload logic for native failures.

**Auto-checks:**
- [ ] `canPlayType` appears before/above hls.js check in detection logic
- [ ] `playsinline` present
- [ ] MKV marked not natively playable
- [ ] TypeScript compiles

**Estimated tokens:** ~500 in / ~2,500–3,500 out

---

### Task 6.2 — Subtitle sync algorithm

**Prompt (copy-paste):**

```
Users load external SRT subtitles for videos and they are frequently out of sync in one of three ways: (a) constant offset (rip vs release timing), (b) linear drift (framerate mismatch: 23.976 vs 25 fps), (c) both. Build the correction system.

Deliver:
1. The math: given user-marked anchor points (user taps "this line is being spoken NOW" at 2 moments), derive offset and scale. Show the formulas. Explain why ONE anchor point can only fix (a) and why TWO fix (b)/(c). What do you do with 3+ anchors (least squares — show it)?
2. Implementation: TypeScript class `SubtitleSyncer` with: parse SRT (handle malformed timestamps, overlapping cues, BOM, CRLF), applyAnchors(anchors: {subtitleTime: number, videoTime: number}[]), getActiveCues(videoTime) in O(log n), and export corrected SRT.
3. Auto-detection bonus path: how would you GUESS the framerate mismatch without user anchors (enumerate the common ratios 25/23.976, 24/25, etc. and describe a scoring heuristic against... what signal? be honest about what's available client-side without speech recognition).
4. Edge cases: negative times after correction, cues that now overlap, drift so large that binary search assumptions break. Handle in code.
```

**Scoring rubric (0–10):**
- **0–2:** Only handles constant offset; parse is `split("\n\n")` with no malformed handling; linear search per frame.
- **3–4:** Two-anchor linear correction present but formula wrong (inverted mapping) or applied to durations not timestamps; O(log n) claimed, array not sorted after correction.
- **5–6:** Correct affine model videoTime = a·subTime + b solved from two anchors; least squares mentioned but not implemented; parser decent; binary search works.
- **7–8:** Full correct math including least squares for 3+ anchors (closed-form for 1D linear regression shown), robust parser, corrected-cue re-sort before binary search, negative-time clamping, honest answer on auto-detection (without ASR, client-side signal is basically only known ratio enumeration + duration heuristics — weak, and says so).
- **9–10:** Above + framerate-ratio table with exact values (1000/1001 factors), overlap resolution policy stated, streaming-safe active-cue lookup (stateful pointer for monotonic playback + binary search fallback for seeks).

**Auto-checks:**
- [ ] Affine formulas explicit (solve a, b from two points)
- [ ] Least squares implemented for 3+ anchors
- [ ] Binary search (or equivalent) in getActiveCues
- [ ] Code compiles; include 2+ test cases that pass

**Estimated tokens:** ~500 in / ~2,500–4,000 out

---

### Task 6.3 — Real-Debrid API integration with rate-limit handling

**Prompt (copy-paste):**

```
Write a TypeScript client module for the Real-Debrid REST API to be used from a Cloudflare Worker, covering: unrestrict a link, add magnet, select files, poll torrent status until downloaded, list downloads. Requirements:

1. Rate limiting: RD allows ~250 requests/minute. Implement a client-side limiter suitable for the Workers runtime (no setInterval assumptions across requests — explain the Workers execution model constraint and your solution: e.g., Durable Object token bucket vs per-isolate best-effort, and when each is appropriate).
2. Polling: torrent status polling with exponential backoff + jitter, hard timeout, and a state machine of RD torrent statuses (magnet_conversion, waiting_files_selection, queued, downloading, downloaded, error, virus, dead) — handle EVERY status explicitly.
3. Error taxonomy: distinguish and type: auth expired (401), permission/premium required (403), infringing/unavailable file, rate-limited (429 with retry semantics), transient 5xx. Retries only where safe (idempotency analysis per endpoint — is "add magnet" retry-safe? answer explicitly).
4. Never leak the API token to the client; show the Worker boundary design.
No external HTTP libraries — fetch only.
```

**Scoring rubric (0–10):**
- **0–2:** Token in client code; setInterval-based limiter (broken in Workers); polls every second forever.
- **3–4:** Decent client but rate limiter is an in-memory counter presented as reliable across isolates (it isn't — must be flagged), or add-magnet blindly retried.
- **5–6:** Correct Workers-model awareness (per-isolate memory is best-effort; Durable Object for real global limiting), backoff present, but status machine incomplete (misses virus/dead) or 429 Retry-After ignored.
- **7–8:** All statuses handled, typed error taxonomy, idempotency reasoning correct (add magnet NOT retry-safe without dedup by hash — dedupe by info-hash before retry), Retry-After respected, jittered backoff with cap, token stays server-side with a clean endpoint boundary.
- **9–10:** Above + waiting_files_selection loop handled (select then re-poll), poll budget tied to Workers CPU/duration limits honestly (suggests alarm/queue for long polls instead of a single request context), and a note on caching unrestrict results.

**Auto-checks:**
- [ ] All 8 statuses appear in code
- [ ] `Retry-After` handled
- [ ] Explicit statement on add-magnet idempotency
- [ ] No token in any client-side snippet
- [ ] TypeScript compiles

**Estimated tokens:** ~500 in / ~3,000–4,500 out

---

## Category 7 — Agent Orchestration (weight: 10%)

---

### Task 7.1 — Handoff brief for a coding agent

**Prompt (copy-paste):**

```
Write a handoff brief for a coding agent (Claude Code) that will implement a feature WITHOUT you in the loop. The feature: add offline support to a Next.js 15 PWA note-taking app (service worker, IndexedDB queue for pending writes, conflict resolution on reconnect, UI states for offline/syncing/conflict).

The brief will be pasted as the agent's only instruction. Judge criteria for your brief: an agent following it literally should succeed; an agent looking for loopholes should find none.

Your brief must include, clearly structured:
1. Scope: exactly what to build, and an explicit NON-goals list (what NOT to touch).
2. Decision authority: which decisions the agent may make alone vs must surface as a question in its final report (it cannot ask mid-task).
3. Verification: the exact commands/checks the agent must run before declaring done, and what "done" means measurably.
4. Constraints: dependency policy, file/folder conventions, migration safety for existing user data.
5. Failure protocol: what the agent should do if it cannot complete something (partial PR conventions, what must never be left broken).
6. Context the agent will otherwise lack: the 5 most load-bearing facts about the codebase/product it must assume (you invent plausible ones and mark them as assumptions to verify).
Maximum 800 words. Every sentence must earn its place — no motivational filler.
```

**Scoring rubric (0–10):**
- **0–2:** A feature description, not a brief — no verification, no non-goals, no failure protocol. Or exceeds 800 words with filler.
- **3–4:** Structure present but decision authority vague ("use your judgment"), verification is "test it works", non-goals generic.
- **5–6:** Solid brief; verification has real commands; but conflict-resolution policy left entirely to the agent (the one decision that most needed pre-deciding), or migration safety unaddressed.
- **7–8:** Pre-decides the dangerous decisions (conflict strategy: e.g., last-write-wins with conflict copies, spelled out), verification measurable (build passes, lighthouse PWA check, specific offline simulation steps), failure protocol concrete (branch conventions, TODO markers format), load-bearing assumptions flagged for verification.
- **9–10:** Reads like it was written by someone who has been burned: anticipates agent failure patterns (over-refactoring, dependency creep, silent scope growth), non-goals block precisely the tempting detours, ≤800 words with zero filler.

**Auto-checks:**
- [ ] ≤800 words
- [ ] All 6 required sections present
- [ ] ≥3 concrete verification commands
- [ ] Explicit conflict-resolution policy chosen (not delegated)

**Estimated tokens:** ~450 in / ~900–1,200 out

---

### Task 7.2 — Planner/executor/verifier split design

**Prompt (copy-paste):**

```
Design a multi-agent orchestration for this workload: converting 120 French medical course PDFs into a clean, chunked, metadata-tagged SQLite corpus (item numbers, specialties, section hierarchy) for a RAG system. Budget constraint: the expensive frontier model may consume at most 10% of total tokens at the start (planning) and 10% at the end (review) — the middle 80% must run on a cheap model. (The "10-80-10" pattern.)

Deliver:
1. Role specification for each agent: planner (frontier), N executors (cheap), verifier (frontier). Exact responsibilities, inputs, outputs, and the artifact each produces.
2. The planner's output format: design the schema of the "work order" the cheap executors receive — it must be so unambiguous that a weak model can follow it (show a filled example for one PDF).
3. Where the 80% goes wrong: list the 4 most likely cheap-model failure modes on this task (e.g., hallucinated item numbers, section hierarchy drift) and the CHEAP, mechanical checks (regex, counts, schema validation — not LLM judging) that catch each before the expensive verifier ever sees them.
4. The verifier's sampling strategy: it cannot review 120 PDFs at 10% budget — design a risk-weighted sampling + escalation policy with actual numbers.
5. Token math: rough budget table (tokens per stage per PDF, totals) proving the 10-80-10 split holds.
```

**Scoring rubric (0–10):**
- **0–2:** Generic "agents collaborate" fluff; no work-order schema; verifier reviews everything (budget ignored).
- **3–4:** Roles described but the work order is prose, not a schema; failure modes generic; no token math.
- **5–6:** Real schema with example; mechanical checks present but weak (only "validate JSON"); sampling strategy exists but numbers don't add up to the stated budget.
- **7–8:** Work order a weak model could actually follow (field-level instructions, enums, examples); failure modes specific to the task (item-number hallucination checked against a canonical item list, chunk-boundary overlap checks, encoding/accent corruption detection, empty-section detection); risk-weighted sampling with escalation (fail rate in sample X% → expand review of that executor's batch); budget table consistent.
- **9–10:** Above + smart wrinkles: canary PDFs with known ground truth seeded into every executor's queue, executor self-reported confidence used only to prioritize (never to skip) verification, and the plan front-loads a pilot batch of 5 PDFs before committing the fleet.

**Auto-checks:**
- [ ] Work-order schema + one filled example
- [ ] 4 failure modes each paired with a non-LLM mechanical check
- [ ] Sampling numbers stated and consistent with 10% budget
- [ ] Budget table present

**Estimated tokens:** ~500 in / ~2,000–3,000 out

---

### Task 7.3 — Critique a bad agent plan

**Prompt (copy-paste):**

```
Below is a plan produced by a coding agent before implementing a task. The task was: "Migrate our production app's user data from localStorage to IndexedDB without losing any user's data. The app has ~40k weekly active users. Some users have up to 5MB of notes in localStorage."

--- AGENT PLAN ---
1. Write new IndexedDB storage module (idb-storage.ts) with the same interface as the current localStorage module.
2. Replace all imports of localStorage-module with idb-storage across the codebase.
3. On app load, check if IndexedDB is empty; if so, copy all localStorage keys into IndexedDB, then call localStorage.clear() to free space.
4. Delete the old localStorage module.
5. Ship it. IndexedDB is supported in all modern browsers so no fallback is needed.
--- END PLAN ---

Critique this plan. Identify every flaw that could cause data loss, breakage, or an unrecoverable state in production. For each flaw: severity (critical/major/minor), the concrete scenario where it bites, and the correction. Then write the corrected plan (numbered, same brevity discipline). Do not pad: if something in the plan is fine, say so.
```

**Scoring rubric (0–10):**
- **0–2:** Vague concerns ("needs more testing") without concrete failure scenarios; misses the destructive `localStorage.clear()`.
- **3–4:** Catches the clear() danger but not the async problem (localStorage sync API vs IndexedDB async — "same interface" is impossible without an async migration of all call sites — this is the deepest flaw), or misses migration-verification-before-delete.
- **5–6:** Catches: clear() before verification, no versioning/flag so a failed partial migration re-runs or double-runs, no rollback. Misses the interface-compatibility impossibility or private-mode/quota errors.
- **7–8:** Full catch list: (1) sync→async interface break [critical], (2) clear() without verifying copied data [critical — verify then keep original for N releases], (3) mid-migration crash leaves half-state with no idempotency marker [critical], (4) IndexedDB unavailable/blocked (private mode, storage pressure, Safari quirks) with no fallback [major], (5) 5MB copy on load blocking main thread / quota errors [major], (6) big-bang ship with no staged rollout or kill switch [major]. Corrected plan is genuinely better and stays terse.
- **9–10:** Above + notes what WAS fine (building the new module first), adds migration telemetry and per-user migration version flag, and the corrected plan sequences verification before any destructive step with an explicit "never clear until version N+2" policy.

**Auto-checks:**
- [ ] `localStorage.clear()` flagged critical
- [ ] Sync vs async interface issue identified
- [ ] Idempotency/partial-migration state addressed
- [ ] Corrected plan present, numbered

**Estimated tokens:** ~450 in / ~1,000–1,800 out

---

## Category 8 — Long-Context + Instruction Following (weight: 2.5%)

---

### Task 8.1 — The 50-constraint spec

**Prompt (copy-paste):**

```
Write a product announcement for a fictional app called "Rihla" (a trip-planning tool). You must satisfy ALL 50 constraints below EXACTLY. After the announcement, output a compliance table: constraint # → how satisfied (quote or count). Any violated constraint is a failure.

1. Total length between 380 and 420 words (count the announcement only, not the table).
2. Exactly 7 paragraphs.
3. Paragraph 1 exactly 2 sentences.
4. The word "Rihla" appears exactly 5 times.
5. Never use the word "journey".
6. Never use the word "seamless".
7. Never use any em dash.
8. No exclamation marks.
9. Include exactly one rhetorical question, in paragraph 4.
10. Paragraph 2 begins with the word "Planning".
11. Paragraph 7 is exactly one sentence.
12. Include the number 14 as a numeral once.
13. Include exactly 3 words in French, italicized with asterisks.
14. One of the French words must be "boussole".
15. No sentence longer than 24 words.
16. At least one sentence of exactly 4 words.
17. Include a two-word slogan in ALL CAPS, appearing exactly once.
18. The slogan must not contain the letter "e".
19. Paragraph 5 must contain exactly 40 words.
20. Never start two consecutive sentences with the same word.
21. Include the phrase "offline first" exactly once, without a hyphen.
22. Mention exactly 3 city names, all real, none in Europe.
23. One city must be Casablanca.
24. No city name may be repeated.
25. Include exactly one semicolon in the entire text.
26. No colons anywhere in the announcement.
27. The word "you" appears at least 6 times.
28. The word "we" appears at most 2 times.
29. Include one sentence that is a question OTHER than the rhetorical one? No — cancel this: the rhetorical question in constraint 9 must be the ONLY question mark in the text.
30. Paragraph 3 contains the word "map" twice.
31. No word may be repeated 3+ times within a single sentence.
32. Include exactly one number written out as a word ("three", "seven", etc.).
33. That written-out number must not be "one".
34. The final word of the announcement is "begins".
35. No paragraph begins with "The".
36. Include exactly 2 words containing the letter "z".
37. Never use passive voice.
38. Include one metaphor involving weather.
39. No bullet points, no lists, no headers: prose only.
40. The letter combination "ing" appears at most 8 times in the whole text.
41. Include the word "Morocco" exactly once.
42. Paragraph 6 begins and ends with the same word.
43. No sentence begins with "And" or "But".
44. Include exactly one word of 12+ letters.
45. No contractions (don't, it's, etc.).
46. Every paragraph contains the letter "r".
47. Include a parenthetical remark exactly once.
48. The parenthetical must be 5 words or fewer.
49. No Oxford comma anywhere.
50. Do not mention artificial intelligence, AI, or machine learning.
```

**Scoring rubric (0–10):** Score = f(constraints actually satisfied, verified by script + manual spot check).
- **0–2:** >15 violations, or no compliance table, or the table lies (claims satisfied when violated — count each lie as 2 violations).
- **3–4:** 8–15 violations. Typical: word counts off, "ing" count blown, letter-z count wrong.
- **5–6:** 4–7 violations. Usually the interacting ones (word count × paragraph counts × forbidden words).
- **7–8:** 1–3 violations, table honest about near-misses.
- **9–10:** 0 violations verified by script (word counts, exact-occurrence greps, punctuation counts), including the trap in #29 (correctly parsed the cancellation), and the compliance table is accurate.

**Auto-checks:** script the countables — word count, paragraph count, occurrences of "Rihla"/"journey"/"seamless"/"you"/"we"/"Morocco"/"offline first", question marks (must be exactly 1), semicolons (1), colons (0), em dashes (0), exclamation (0), "ing" count, z-words, final word, contractions regex.

**Estimated tokens:** ~800 in / ~900–1,400 out

---

### Task 8.2 — Contradiction buried in a long French medical document

**Prompt (copy-paste):**

```
Lis attentivement le protocole interne suivant (fictif) destiné aux internes d'un service. Ta mission : identifier TOUTE incohérence interne (une section qui contredit une autre section du MÊME document). Ne signale pas les écarts avec les recommandations nationales — uniquement les contradictions internes. Cite les passages exacts en conflit et explique pourquoi ils sont incompatibles. S'il existe plusieurs contradictions, trouve-les toutes. S'il n'y en a qu'une, ne fabrique pas les autres.

--- PROTOCOLE SERVICE DE MÉDECINE INTERNE — ANTICOAGULATION (v3.2, document fictif d'entraînement) ---

SECTION 1 — OBJET. Le présent protocole encadre la prescription des anticoagulants oraux directs (AOD) et des héparines dans le service, pour la maladie thromboembolique veineuse (MTEV) et la fibrillation atriale (FA).

SECTION 2 — ÉVALUATION INITIALE. Avant toute prescription d'anticoagulant, l'interne doit documenter : poids, âge, créatininémie avec calcul de la clairance selon Cockcroft-Gault, bilan hépatique, hémoglobine et plaquettes. Le score HAS-BLED est calculé pour la FA. Toute clairance inférieure à 30 mL/min doit être signalée au senior avant prescription.

SECTION 3 — CHOIX DE LA MOLÉCULE DANS LA FA. En première intention, un AOD est proposé (apixaban, rivaroxaban ou dabigatran). L'apixaban est utilisable jusqu'à une clairance de 15 mL/min, avec réduction de dose selon les critères habituels (âge ≥ 80 ans, poids ≤ 60 kg, créatininémie ≥ 133 µmol/L : deux critères sur trois imposent la dose réduite de 2,5 mg deux fois par jour). Le dabigatran est contre-indiqué si la clairance est inférieure à 30 mL/min.

SECTION 4 — MTEV À LA PHASE AIGUË. Le traitement repose sur un AOD d'emblée (apixaban ou rivaroxaban avec leur phase de charge respective) ou sur une HBPM avec relais. La durée minimale de traitement d'une embolie pulmonaire provoquée par un facteur transitoire majeur est de 3 mois. Une réévaluation en consultation est systématique avant tout arrêt.

SECTION 5 — INSUFFISANCE RÉNALE. Chez tout patient dont la clairance est inférieure à 25 mL/min, aucun AOD ne doit être prescrit dans le service, quelle que soit l'indication ; le recours est l'HBPM à dose adaptée avec surveillance anti-Xa, ou l'HNF selon le contexte. Cette règle ne souffre aucune exception sans validation écrite du chef de service.

SECTION 6 — SURVEILLANCE. Les AOD ne nécessitent pas de surveillance biologique de routine de leur activité. La fonction rénale est réévaluée au minimum une fois par an si la clairance initiale dépasse 60 mL/min, tous les 6 mois entre 30 et 60 mL/min, et tous les 3 mois en dessous de 30 mL/min chez les patients sous AOD.

SECTION 7 — DURÉES DE TRAITEMENT DANS LA MTEV. Pour une embolie pulmonaire provoquée par un facteur transitoire majeur, le traitement anticoagulant est poursuivi 6 mois au minimum avant réévaluation. Les MTEV non provoquées relèvent d'une discussion de prolongation au-delà de la période initiale.

SECTION 8 — CAS PARTICULIERS. Chez le patient de plus de 80 ans en FA avec clairance entre 15 et 25 mL/min, l'apixaban à dose réduite constitue l'option de référence du service, conformément à la section 3.
--- FIN DU PROTOCOLE ---
```

**Reference key — the document contains exactly 3 internal contradictions:**
1. **Section 4 vs Section 7:** durée minimale EP provoquée par facteur transitoire majeur = "3 mois" (S4) vs "6 mois au minimum" (S7). Direct numeric conflict, same clinical situation.
2. **Section 3/8 vs Section 5:** S3 allows apixaban down to 15 mL/min and S8 makes it the service reference for clearance 15–25 mL/min, while S5 forbids ALL AOD below 25 mL/min "quelle que soit l'indication". S8 even cites S3 "conformément", compounding it.
3. **Section 6 vs Section 5 (subtle):** S6 defines AOD renal monitoring every 3 months "en dessous de 30 mL/min chez les patients sous AOD" — a population that S5 says cannot exist below 25 mL/min; the 25–30 band is coherent, so this one is only a *partial* contradiction/incoherence-by-implication. **Credit models that flag it with the correct nuance (the <25 slice of that statement is vacuous per S5); do not penalize models that exclude it with correct reasoning. Penalize models that call the whole of S6 contradictory without the band analysis.**

**Scoring rubric (0–10):**
- **0–2:** Finds nothing, or reports external-guideline deviations despite the explicit instruction not to, or invents contradictions (e.g., claims the apixaban dose-reduction criteria are internally inconsistent).
- **3–4:** Finds only the loud one (3 vs 6 months).
- **5–6:** Finds both hard contradictions (durations + AOD threshold) with exact quotes, but adds a fabricated third or mislabels guideline deviations as internal conflicts.
- **7–8:** Both hard contradictions with exact conflicting passages and clean explanations; no fabrications; notes S8 amplifies contradiction #2.
- **9–10:** Above + handles the S6 subtlety with correct band reasoning (25–30 vs <25), and explicitly resists inventing more ("je n'identifie pas d'autre contradiction interne").

**Auto-checks:**
- [ ] "3 mois" vs "6 mois" conflict identified with both section numbers
- [ ] 15/25 mL/min AOD conflict identified citing S5 and S3 or S8
- [ ] No external-guideline critique presented as an internal contradiction

**Estimated tokens:** ~1,300 in / ~500–1,000 out

---

## Category 9 — Cost/Latency Awareness (weight: 2.5%)

**What's being measured:** quality per token. Run each task twice per model where specified; the score is quality under budget, and you log cost. This category is also where cheap models get to win.**

---

### Task 9.1 — Compressed technical explanation

**Prompt (copy-paste):**

```
Explain the difference between SSR, SSG, ISR, and streaming SSR in Next.js App Router, including when each hits the server and what the user perceives. Hard budget: 150 words maximum. Every word over budget is a penalty. Do not use bullet points; prose only. A competent mid-level developer must come away able to choose between them.
```

**Scoring rubric (0–10):**
- **0–2:** Over budget by >20%, or so compressed it's wrong (e.g., claims ISR regenerates on every request).
- **3–4:** Within ~budget but wastes words on preamble ("Great question! In modern web development…"), or omits one of the four.
- **5–6:** In budget, all four covered, accurate, but no decision guidance (describes without differentiating when to choose).
- **7–8:** In budget, accurate, includes the perceptual difference (TTFB vs streamed shell) and an implicit decision rule; zero filler words.
- **9–10:** Under 150 with headroom, dense but readable, captures revalidation semantics of ISR correctly and the Suspense-boundary essence of streaming — reads like it was edited three times.
- **Scoring formula for the category:** quality score × (1 − overage%), then note tokens used. Log $/quality-point per model.

**Auto-checks:**
- [ ] ≤150 words (script count)
- [ ] All four terms present
- [ ] No bullet points

**Estimated tokens:** ~90 in / ~200 out

---

### Task 9.2 — Minimal-budget code

**Prompt (copy-paste):**

```
Write a JavaScript function debounceWithFlush(fn, wait) returning a debounced function with two extra methods: .flush() (invoke pending call immediately with last args) and .cancel(). Preserve `this` and arguments. Handle: flush when nothing pending (no-op), cancel then call again (works normally). Output ONLY the code, zero prose, zero comments, no markdown fences if your interface allows raw output. Budget: 30 lines maximum.
```

**Scoring rubric (0–10):**
- **0–2:** Doesn't work (loses args/this, flush calls fn with stale/no args, timer leak), or drowning in comments/prose despite the instruction.
- **3–4:** Works for basic case; flush or cancel edge broken (flush after cancel invokes; flush with nothing pending throws).
- **5–6:** Functionally correct, but >30 lines or prose included.
- **7–8:** Correct, ≤30 lines, both edges handled, `this` preserved via apply, no prose.
- **9–10:** Correct, tight (≤20 lines), reads cleanly, clears state before invoking to avoid reentrancy bugs.

**Auto-checks (run in container):**
- [ ] Executes: basic debounce works (fake timers or sleep-based test)
- [ ] flush() with pending → immediate invoke with last args; without pending → no-op
- [ ] cancel() then call → works
- [ ] Zero prose lines outside code
- [ ] ≤30 lines

**Estimated tokens:** ~120 in / ~150–300 out

---

### Task 9.3 — Budgeted summarization with fidelity

**Prompt (copy-paste):**

```
Résume le texte suivant en 60 mots MAXIMUM, en français, sans perdre aucune des informations critiques suivantes qui doivent toutes survivre au résumé : le seuil de clairance, les deux molécules citées, la conduite à tenir en cas de surdosage, et la fréquence de surveillance. Chaque information critique manquante est une faute majeure. Pas de liste ; prose.

TEXTE : "Chez les patients traités par apixaban ou rivaroxaban, la fonction rénale doit être réévaluée tous les six mois lorsque la clairance de la créatinine est comprise entre 30 et 60 mL/min. En dessous de 30 mL/min, la poursuite du traitement doit être discutée avec un avis spécialisé, car le risque hémorragique augmente. En cas de surdosage asymptomatique constaté, le traitement est suspendu et la fonction rénale contrôlée ; en cas d'hémorragie grave, un agent de réversion spécifique ou du concentré de complexe prothrombinique est administré selon la molécule et la disponibilité. Les patients doivent être éduqués à reconnaître les signes hémorragiques et à ne jamais interrompre le traitement de leur propre initiative."
```

**Scoring rubric (0–10):**
- **0–2:** Over 60 words by >20% or drops ≥2 critical facts.
- **3–4:** In budget but drops one critical fact (usually the reversal/surdosage handling), or answers in English.
- **5–6:** All facts present, ≤60 words, but garbled French or the 30 vs 30–60 thresholds blurred together.
- **7–8:** All four critical facts intact and precise, ≤60 words, natural French prose.
- **9–10:** Same, with headroom under budget and no fidelity loss — the thresholds, molecules, overdose conduct and monitoring frequency all exact.

**Auto-checks:**
- [ ] ≤60 words
- [ ] Contains "30" and "six mois"/"6 mois"
- [ ] Contains "apixaban" and "rivaroxaban"
- [ ] French

**Estimated tokens:** ~300 in / ~100 out

---

## 10. Scoring Spreadsheet Structure

One sheet per benchmark run cycle. Suggested tabs:

### Tab 1 — `raw_scores`

| Column | Content |
|---|---|
| task_id | 1.1 … 9.3 |
| category | 1–9 name |
| model | model + exact version string |
| run_date | ISO date |
| score_0_10 | final rubric score |
| auto_checks_passed | e.g. 5/6 |
| bluff_penalties | medical categories only |
| judge | "me" / "judge-model" / "script" |
| in_tokens / out_tokens / latency_s / cost_usd | from provider |
| notes | one line max |
| output_file | runs/{model}/{task-id}.md |

### Tab 2 — `category_scores` (computed)

Category score per model = mean of its 3 task scores (0–10).

| Category | Weight | Fable 5 | GPT-5.6 | Gemini 3.5 F | Grok 4.5 | GLM 5.2 | Muse Spark |
|---|---|---|---|---|---|---|---|
| 1. Agentic coding | 20% | | | | | | |
| 2. Medical reasoning (FR/EDN) | 20% | | | | | | |
| 3. RTL/Arabic engineering | 10% | | | | | | |
| 4. Frontend design taste | 15% | | | | | | |
| 5. Medical RAG/retrieval | 15% | | | | | | |
| 6. Streaming/media infra | 5% | | | | | | |
| 7. Agent orchestration | 10% | | | | | | |
| 8. Long-context + IF | 2.5% | | | | | | |
| 9. Cost/latency | 2.5% | | | | | | |
| **WEIGHTED TOTAL** | 100% | | | | | | |

Formula: `TOTAL = Σ (category_mean × weight)` → a 0–10 headline number per model.

### Tab 3 — `cost_efficiency`

Per model: total cost across 27 tasks, weighted total score, and **quality-per-dollar = weighted_total / total_cost_usd**. Also track quality-per-dollar within Cat 1 and Cat 2 separately — those are the two you route real work by.

### Tab 4 — `run_log`

Every anomaly: temperature unavailable (`†`), truncated outputs, provider errors, guideline updates that invalidated a medical reference answer (bump benchmark version when this happens).

---

## 11. Judging Protocol

### Who judges what

| Tasks | Judge | Why |
|---|---|---|
| 1.1, 1.3, 3.1, 5.2, 6.1, 6.2, 6.3, 9.2 | **Script first, then judge model, you spot-check** | Compile/run/grep checks carry most of the signal |
| 8.1, 9.1, 9.3 | **Script almost entirely** | Countable constraints |
| **2.1, 2.2, 2.3, 5.3, 8.2** | **YOU, always, against your course references** | Medical. A judge model can pre-annotate, but no medical score is final until you verify against collèges/HAS. Non-negotiable. |
| 4.1, 4.2, 4.3 | **You, blind** (render the HTML, no model names visible) | Taste cannot be delegated; judge models reward exactly the slop you hate |
| 1.2, 3.2, 3.3, 5.1, 7.1, 7.2, 7.3 | **Judge model scores + you review anything ≥7 or ≤3** | Rubrics are explicit enough for model judging; you audit the tails |

### Medical verification procedure (Cat 2, 5.3, 8.2)

1. Run auto-checks first (they catch gross failures cheap).
2. Read the model output against the reference key in this document.
3. **Then verify the reference key itself against your current collèges/HAS/SPILF references** — the keys in this file were written in July 2026 and guidelines move. If a key is outdated, fix the key, bump the version (v1.1), and re-score all models on that task.
4. Apply bluff penalties strictly: a confidently wrong number is worse than an honest "je ne sais pas".

### Judge model prompt (paste verbatim; attach the task prompt, the rubric, and the anonymized output)

```
You are a strict benchmark judge. You will receive: (1) TASK — the exact prompt a model was given, (2) RUBRIC — a 0–10 scale with point bands and auto-check criteria, (3) OUTPUT — the model's response, anonymized.

Rules:
- Score ONLY against the rubric. Do not reward effort, length, politeness, or confident tone. Do not penalize brevity if requirements are met.
- Work through the auto-check list first, marking each pass/fail with the evidence (quote the line or state its absence).
- Then assign the band: start from the band description that best matches, and justify with specific quotes. If the output sits between bands, take the LOWER band unless there is concrete evidence for the higher one.
- Instruction violations cap the score: if the task specified a format/limit/language and the output violates it, the maximum score is 4 regardless of content quality.
- If the output contains a factual claim you cannot verify from the task materials, do not assume it is correct; note it as UNVERIFIED. Never raise a score based on an unverified claim.
- You must not infer which AI lab produced this output, and style familiarity must not influence the score.

Return exactly:
SCORE: <integer 0–10>
AUTO_CHECKS: <n passed>/<n total>, list of failures
BAND_JUSTIFICATION: <3–6 sentences with quotes>
UNVERIFIED_CLAIMS: <list or "none">
RED_FLAGS: <fabrication, instruction violation, or "none">
```

Use a judge model that is NOT under test in the same run if possible; if it must be one of the tested models, never let it judge its own outputs, and note it in the run log.

---

## 12. Versioning & Maintenance

- **Contamination rule:** never paste this document into any model except as individual task prompts at test time. If a task appears to have leaked into training (a model answers a trap suspiciously perfectly, verbatim-echoing your rubric language), rotate the task's surface details (names, numbers, molecules) while preserving its skeleton, and bump the version.
- **Guideline drift:** medical reference keys are dated 2026-07. Re-verify quarterly.
- **Adding a model:** run all 27 tasks in one session, fill Tab 1, compute Tabs 2–3, compare headline + quality-per-dollar.
- **Changing a task:** only between full run cycles; never mid-comparison.

*End of KNIGHT-BENCH v1. Save as `knight-bench-v1.md`.*
