import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const judging = path.join(root, "judging");
const outScore = path.join(judging, "scorecards");
const human = path.join(judging, "human-review");

const models = ["gemini", "grok", "sonnet"];
const modelName = {
  gemini: "Gemini 3.5 Flash",
  grok: "Grok 4.5",
  sonnet: "Claude Sonnet 5",
};
const resultDir = {
  gemini: "gemini-3.5-flash-results",
  grok: "grok-4.5-results",
  sonnet: "sonnet-5-results",
};

const categories = {
  "1": { name: "Agentic coding", weight: 20, tasks: ["1.1", "1.2", "1.3"] },
  "2": { name: "Medical reasoning (FR/EDN)", weight: 20, tasks: ["2.1", "2.2", "2.3"] },
  "3": { name: "RTL/Arabic engineering", weight: 10, tasks: ["3.1", "3.2", "3.3"] },
  "4": { name: "Frontend design taste", weight: 15, tasks: ["4.1", "4.2", "4.3"] },
  "5": { name: "Medical RAG/retrieval", weight: 15, tasks: ["5.1", "5.2", "5.3"] },
  "6": { name: "Streaming/media infra", weight: 5, tasks: ["6.1", "6.2", "6.3"] },
  "7": { name: "Agent orchestration", weight: 10, tasks: ["7.1", "7.2", "7.3"] },
  "8": { name: "Long-context + IF", weight: 2.5, tasks: ["8.1", "8.2"] },
  "9": { name: "Cost/latency", weight: 2.5, tasks: ["9.1", "9.2", "9.3"] },
};

const taskCategory = Object.fromEntries(Object.entries(categories).flatMap(([c, v]) => v.tasks.map(t => [t, c])));

const provisionalTasks = new Set(["2.1", "2.2", "2.3", "4.1", "4.2", "4.3", "5.3", "8.2"]);
const allTasks = Object.values(categories).flatMap(c => c.tasks);

const scores = {
  "1.1": { gemini: 8, grok: 8, sonnet: 6 },
  "1.2": { gemini: 8, grok: 8, sonnet: 9 },
  "1.3": { gemini: 6, grok: 6, sonnet: 4 },
  "2.1": { gemini: 8, grok: 7, sonnet: 8 },
  "2.2": { gemini: 9, grok: 8, sonnet: 8 },
  "2.3": { gemini: 8, grok: 6, sonnet: 9 },
  "3.1": { gemini: 6, grok: 9, sonnet: 9 },
  "3.2": { gemini: 7, grok: 9, sonnet: 9 },
  "3.3": { gemini: 7, grok: 9, sonnet: 10 },
  "4.1": { gemini: 4, grok: 5, sonnet: 8 },
  "4.2": { gemini: 6, grok: 8, sonnet: 8 },
  "4.3": { gemini: 6, grok: 7, sonnet: 5 },
  "5.1": { gemini: 8, grok: 9, sonnet: 9 },
  "5.2": { gemini: 8, grok: 10, sonnet: 4 },
  "5.3": { gemini: 8, grok: 9, sonnet: 9 },
  "6.1": { gemini: 5, grok: 5, sonnet: 8 },
  "6.2": { gemini: 8, grok: 8, sonnet: 9 },
  "6.3": { gemini: 7, grok: 8, sonnet: 8 },
  "7.1": { gemini: 5, grok: 4, sonnet: 4 },
  "7.2": { gemini: 8, grok: 10, sonnet: 8 },
  "7.3": { gemini: 8, grok: 10, sonnet: 10 },
  "8.1": { gemini: 6, grok: 10, sonnet: 5 },
  "8.2": { gemini: 8, grok: 10, sonnet: 8 },
  "9.1": { gemini: 8, grok: 9, sonnet: 8 },
  "9.2": { gemini: 8, grok: 6, sonnet: 8 },
  "9.3": { gemini: 8, grok: 9, sonnet: 8 },
};

const notes = {
  "1.1": {
    gemini: "Complete, compiling implementation with plan, IDB schema, client island, profile-change event, and forced save hooks; minor concern is global throttle state rather than per-title/per-profile throttle state.",
    grok: "Strong design with per-key throttling and delete-on-complete policy; compile check leaves a scaffold type-argument failure, but the architecture meets the core requirements.",
    sonnet: "Good plan and schema but riskier integration: it omits a declared `lib/db.ts` block and passes a ref into the given `Player` contract; compilation also reports `getTitles()`/ref issues.",
  },
  "1.2": {
    gemini: "Finds the core iOS fallback, Range/206, MIME, and MP4-vs-HLS bugs, but ranks proxy bypass ahead of the manifest MIME/native-HLS first failure and misses the explicit native-HLS auto-check phrasing.",
    grok: "Excellent diagnosis including empty Range and segment proxy holes, but several diffs exceed the <=15-line constraint and the answer drifts beyond the minimal-diff instruction.",
    sonnet: "Best-focused answer: identifies native HLS, unproxied fallback, manifest MIME as the first failure, 206 preservation, and MP4 branching with localized fixes.",
  },
  "1.3": {
    gemini: "One interval and matching line count, but no AbortController; it relies on an `active` boolean and the checker found the DOM block not byte-identical modulo whitespace.",
    grok: "Similar to Gemini: one interval and correct line-count comment, but `alive` boolean instead of AbortController and DOM preservation was not exact under the scripted check.",
    sonnet: "Compiles and consolidates intervals, but the `// LINES:` comment is wrong and it uses an `isMounted` ref rather than AbortController, so the hard constraints cap the score.",
  },
  "2.1": {
    gemini: "Substantively correct STEMI/SCA ST+ management with 10-minute ECG, IVA, 120-minute ICP threshold, DAPT, anticoagulation, and oxygen-only-if-hypoxic nuance.",
    grok: "Excellent reasoning overall, but it states oxygen only if SpO2 <94%, which conflicts with the reference key's <90% threshold and triggers a medical-number penalty.",
    sonnet: "Concise and correct: SCA/IDM, ECG in 10 minutes, IVA, ICP within 120 minutes, DAPT/anticoagulation, and O2 only if <90%.",
  },
  "2.2": {
    gemini: "Correct Cockcroft result and full anticoagulation decision; the output is overlong but clinically aligned and includes HNF/TCA/anti-Xa/plaquette monitoring.",
    grok: "Correct result and thoughtful uncertainty, but several calculation lines omit units despite the instruction and the answer adds many protocol-specific numbers for owner verification.",
    sonnet: "Correct result and management, with useful uncertainty notes; some intermediate lines are unit-light, so it stays below the top band.",
  },
  "2.3": {
    gemini: "Clean trap handling: fosfomycin-trometamol 3 g single dose, no ECBU, and fluoroquinolone stewardship rationale.",
    grok: "The first-line answer is correct, but it also calls pivmecillinam/nitrofurantoin alternatives '1ere intention', contaminating the French first-line trap with a non-key recommendation.",
    sonnet: "Best concise answer: fosfomycin 3 g single dose, no ECBU, correct exceptions, pivmecillinam only as second line, and FQ stewardship.",
  },
  "3.1": {
    gemini: "Meets most bidi design requirements but the submitted JSX does not compile, with parser errors around CSS-in-JSX braces.",
    grok: "Compiles and meets all grep checks: first-strong detection ranges, logical properties, bidi isolation, and real failure notes.",
    sonnet: "Also compiles and satisfies the bidi checks; the solution is disciplined about logical properties and isolation.",
  },
  "3.2": {
    gemini: "Strong typography discussion, but misses the explicit `font-synthesis` check for the faux-bold item.",
    grok: "Covers all six mechanisms with OpenType, GPOS, digit shaping, direction-aware truncation, and font-synthesis controls.",
    sonnet: "Detailed, practical, and tradeoff-aware across all six issues, including `font-synthesis: none` and whole-word truncation.",
  },
  "3.3": {
    gemini: "Strong on Uthmani fonts, page-specific strategy, Quranic ranges, WJ/NBSP, and FTS5; weaker because the do-not-strip list is not as explicit to the checker and 0670 handling is not nuanced enough.",
    grok: "Very complete technical doc with Uthmani-specific font strategy, correct stripping ranges, nonbreaking markers, and FTS5 external-content schema.",
    sonnet: "Top answer: highly explicit about QCF/page fonts, CSS kashida limits, do-not-strip letters, and external-content FTS5 normalization.",
  },
  "4.1": {
    gemini: "Provisionally weak design packet: line count/external request/RTL-root checks fail and the result reads less like a single offline cinematic file.",
    grok: "More conceptually ambitious than Gemini but still trips external/RTL/emoji checks and needs owner blind taste review.",
    sonnet: "Best provisional landing-page packet: mostly passes mechanical checks and has stronger cinematic/Arabic-first direction, though an emoji check fired.",
  },
  "4.2": {
    gemini: "Respectable component concept but exceeds the 250-line cap, so it cannot reach the upper band.",
    grok: "Clean provisional result: passes all mechanical checks, isolates rAF, and respects the explicit visual bans.",
    sonnet: "Also passes all mechanical checks with a restrained component and correct rAF/RTL behavior.",
  },
  "4.3": {
    gemini: "Coherent enough visual-system spec, but the demo exceeds the 400-line limit.",
    grok: "Good tokens/spec/demo alignment overall; the demo packet is offline and within line count, with only a mechanical demo-line observation in the generated packet.",
    sonnet: "Concept exceeds the 120-word cap and demo uses hex values not present in the token JSON, making the system less auditable.",
  },
  "5.1": {
    gemini: "Meets all scripted checks with a clear two-hop FTS5/BM25 design, worked SQL, and failure modes; less deep on French-specific lexicon and measurable stopping criteria than the best answers.",
    grok: "Very strong pipeline with relation tables, metadata filters, superlative-aware extraction, risk telemetry, and a realistic latency/cost comparison; the embedding regex failure is from explicit 'no embeddings' language.",
    sonnet: "Strong and honest design with external-content FTS5, filtered hops, measured assumptions, and failure modes; similar false auto-fail from saying embeddings are not used.",
  },
  "5.2": {
    gemini: "Runnable Python submission: `py -3` and `unittest` both passed 8 tests, covering ligatures, accents, abbreviations, phrase boost, and weights.",
    grok: "Best verified code: companion files ran 15/15 tests, with data-driven ambiguity handling and explicit `œ`/`oe` normalization.",
    sonnet: "Conceptually strong TypeScript, but it imports `vitest`, has a `Database` namespace error, and fails both `tsc` and `node --test`; runnable-code rubric limits the score.",
  },
  "5.3": {
    gemini: "Correctly flags all planted unsupported items and rewrites safely, but does not articulate the verifier principle or ivabradine double-fault as strongly as the top band.",
    grok: "Excellent attribution discipline: flags the true-but-unsourced dose and all planted hallucinations, explains plausibility is not support, and rewrites only supported claims.",
    sonnet: "Equally strong, explicitly noting ivabradine is unsourced and not first-line and that restriction hydrique is clinically risky.",
  },
  "6.1": {
    gemini: "Knows playsinline and MKV truth, but checks `Hls.isSupported()` before native `canPlayType`, the key iOS ordering trap, and compile check fails.",
    grok: "Same major trap as Gemini: hls.js check appears before native HLS detection; otherwise the matrix and traps are good.",
    sonnet: "Gets the native-HLS detection order right and covers playsinline/MKV; compile failure is mostly hls.js/Worker-type scaffolding, so content reaches the 7-8 band.",
  },
  "6.2": {
    gemini: "Compiling TypeScript with affine formulas, least squares, binary search, and tests; good but not the richest edge-policy answer.",
    grok: "Also compiles and covers the math and O(log n) lookup; solid 7-8 band.",
    sonnet: "Strongest implementation here, with 17 test markers, compilation success, and a fuller edge-case treatment.",
  },
  "6.3": {
    gemini: "Handles all statuses, Retry-After, idempotency, and token boundary; compile check fails on an extracted RateLimiter snippet, keeping it below top.",
    grok: "Rich RD client design with Durable Object awareness and all status/error handling; compile check fails because snippets/modules were not provided as a complete compiling package.",
    sonnet: "Similar upper-band content with Worker boundary and idempotency reasoning; compile check fails on Worker/module references.",
  },
  "7.1": {
    gemini: "Under 800 words with sections and commands, but leaves the conflict-resolution policy insufficiently pre-decided.",
    grok: "Slightly over 800 words and conflict policy still too delegated; hard budget/instruction discipline costs it.",
    sonnet: "Over 800 words by a lot and no explicit chosen conflict policy; despite useful content, the format cap bites.",
  },
  "7.2": {
    gemini: "Solid 10-80-10 plan with schema, failure checks, sampling, and budget table; less advanced than the best on canaries/pilot feedback loops.",
    grok: "Best orchestration answer: exhaustive work-order schema, mechanical gates, risk-tier sampling, escalation, token metering, and cheap retries.",
    sonnet: "Strong and honest, but its own budget table lands verifier at 11.5% before proposing adjustments, so it stays below the top score.",
  },
  "7.3": {
    gemini: "Catches sync/async mismatch, clear danger, partial migration, private-mode/blocking, and rollback; corrected plan is solid but less explicit on rollout/kill-switch policy.",
    grok: "Excellent critique with destructive clear, async API impossibility, idempotent migration, quota/private failures, staged rollout, telemetry, and corrected plan.",
    sonnet: "Top-tier critique: catches multi-tab races, private-mode/quotas, async mismatch, rollback, corrupt keys, says what was fine, and gives a terse corrected plan.",
  },
  "8.1": {
    gemini: "Script found 45/50 constraints satisfied and no compliance lies; five violations place it in the 4-7 violation band.",
    grok: "Script verified 50/50 constraints and zero compliance-table lies, including the cancellation trap at #29.",
    sonnet: "Script found 44/50 constraints satisfied; six violations, including `ing` count and city count, put it in the 4-7 violation band.",
  },
  "8.2": {
    gemini: "Finds both hard contradictions with exact quotes and no fabrication, but omits the S6 25-30 vs <25 nuance.",
    grok: "Best answer: finds both hard contradictions and explicitly treats S6 as a partial/tension case with 25-30 vs <25 reasoning.",
    sonnet: "Finds the two hard contradictions and resists inventing extras, but dismisses S6 as compatible by pointing only to 25-30 and not the <25 slice.",
  },
  "9.1": {
    gemini: "In budget at 135 words, accurate and useful, but less sharp on ISR/Suspense than Grok.",
    grok: "Exactly 150 words, dense and precise, with ISR background regeneration and streaming/Suspense perception captured.",
    sonnet: "Content is excellent, but the script counted 154 words; applying the overage penalty keeps it below Grok.",
  },
  "9.2": {
    gemini: "Behavioral debounce tests pass, no prose, 26 lines; clean but not ultra-tight.",
    grok: "Behavioral tests pass and no prose, but 32 nonblank lines violates the 30-line budget, pushing it to the 5-6 band.",
    sonnet: "Behavioral tests pass, no prose, 25 lines; clear implementation, though stale args remain in memory after cancel/flush.",
  },
  "9.3": {
    gemini: "Within 56 words and keeps molecules, monitoring frequency, threshold, and overdose actions, though it compresses the <30 specialized-advice nuance.",
    grok: "Best summary: 52 words and preserves the 30/30-60 thresholds, both drugs, specialized advice, and overdose conduct.",
    sonnet: "Within 57 words and faithful, but slightly less complete than Grok on 'availability/according to molecule' wording.",
  },
};

const quotePatterns = {
  "1.1": ["PLAN", "IndexedDB", "force", "profile"],
  "1.2": ["native", "Content-Type", "206", "MP4"],
  "1.3": ["LINES", "setInterval", "AbortController", "audit"],
  "2.1": ["120", "IVA", "SpO", "double"],
  "2.2": ["29,8", "30", "HNF", "TCA"],
  "2.3": ["Fosfomycine", "ECBU", "fluoroquinolones"],
  "3.1": ["unicode-bidi", "0600", "inline", "BIDI NOTES"],
  "3.2": ["letter-spacing", "font-synthesis", "OpenType"],
  "3.3": ["06D6", "hamza", "U+2060", "FTS5"],
  "4.1": ["مدار", "DESIGN RATIONALE", "dir=\"rtl\""],
  "4.2": ["requestAnimationFrame", "backdrop-filter", "rtl"],
  "4.3": ["CONCEPT", "TOKENS", "FORBIDDEN"],
  "5.1": ["CREATE VIRTUAL TABLE", "bm25", "Hop 1", "Hop 2"],
  "5.2": ["remove_diacritics", "IRC", "œ", "test"],
  "5.3": ["1,25", "ivabradine", "antipneumococcique", "restriction hydrique"],
  "6.1": ["canPlayType", "playsinline", "MKV", "Hls.isSupported"],
  "6.2": ["least squares", "getActiveCues", "binary", "23.976"],
  "6.3": ["Retry-After", "waiting_files_selection", "idempot", "Durable"],
  "7.1": ["Scope", "Verification", "conflict", "NON-goals"],
  "7.2": ["work order", "mechanical", "sample", "10-80-10"],
  "7.3": ["localStorage.clear", "async", "idempotent", "Corrected Plan"],
  "8.1": ["Rihla", "Compliance", "Constraint"],
  "8.2": ["3 mois", "6 mois", "15", "25"],
  "9.1": ["SSR", "ISR", "Streaming"],
  "9.2": ["function debounceWithFlush", "flush", "cancel"],
  "9.3": ["apixaban", "rivaroxaban", "surdosage"],
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readTask(model, task) { return fs.readFileSync(path.join(root, "results", resultDir[model], `task-${task}.md`), "utf8"); }
function evidence(model, task) { return fs.readFileSync(path.join(judging, "evidence", model, `${task}-checks.md`), "utf8"); }
function firstLine(s) { return s.split(/\r?\n/).map(x => x.trim()).find(Boolean) || ""; }
function clean(s) { return s.replace(/\s+/g, " ").trim(); }
function short(s, n = 180) { const c = clean(s); return c.length > n ? c.slice(0, n - 1) + "…" : c; }
function quote(text, patterns) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const out = [];
  for (const p of patterns) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const line = lines.find(l => re.test(l) && l.length > 8);
    if (line && !out.includes(line)) out.push(short(line, 170));
    if (out.length >= 3) break;
  }
  if (!out.length) out.push(short(firstLine(text), 170));
  return out;
}
function auto(model, task) {
  const ev = evidence(model, task);
  const pass = (ev.match(/\[PASS\]/g) || []).length;
  const fail = (ev.match(/\[FAIL\]/g) || []).length;
  const failures = ev.split(/\r?\n/).filter(l => l.includes("[FAIL]")).map(l => l.replace(/^- /, ""));
  return { pass, fail, total: pass + fail, failures };
}
function status(task) { return provisionalTasks.has(task) ? "PROVISIONAL" : "FINAL"; }
function taskWeight(task) {
  const c = categories[taskCategory[task]];
  return c.weight / c.tasks.length;
}
function catMean(model, cat, taskSet = null) {
  const tasks = categories[cat].tasks.filter(t => !taskSet || taskSet.has(t));
  if (!tasks.length) return null;
  return tasks.reduce((a, t) => a + scores[t][model], 0) / tasks.length;
}
function allWeighted(model) {
  return Object.entries(categories).reduce((sum, [cat, c]) => sum + catMean(model, cat) * c.weight / 100, 0);
}
function finalOnly(model) {
  let weighted = 0, w = 0;
  for (const task of allTasks) {
    if (provisionalTasks.has(task)) continue;
    const tw = taskWeight(task);
    weighted += scores[task][model] * tw;
    w += tw;
  }
  return { normalized: weighted / w, settledContribution: weighted / 100, includedWeight: w };
}
function provisionalSwing(model) {
  let current = 0, max = 0;
  for (const task of allTasks) {
    if (!provisionalTasks.has(task)) continue;
    const tw = taskWeight(task);
    current += scores[task][model] * tw / 100;
    max += 10 * tw / 100;
  }
  return { current, minTotal: allWeighted(model) - current, maxTotal: allWeighted(model) - current + max, currentProv: current, provWeight: max };
}

function writeScorecards() {
  for (const model of models) {
    ensureDir(path.join(outScore, model));
    for (const task of allTasks) {
      const text = readTask(model, task);
      const a = auto(model, task);
      const qs = quote(text, quotePatterns[task] || []);
      const unverified = provisionalTasks.has(task)
        ? "Medical/design item requires owner ratification against course references or blind taste review."
        : "none beyond claims not testable from task materials";
      const red = [];
      if (a.failures.length) red.push(`auto-check failures: ${a.failures.map(f => f.replace(/\|/g, "/")).join("; ")}`);
      if (task === "5.2" && model === "sonnet") red.push("runnable-code failure: vitest dependency / TS error");
      if (task === "2.3" && model === "grok") red.push("trap contamination: nitrofurantoin called alternative first-intention");
      if (task === "8.1" && scores[task][model] < 9) red.push("countable constraint violations");
      const lines = [
        `SCORE: ${scores[task][model]} (${status(task)})`,
        `AUTO_CHECKS: ${a.pass}/${a.total}${a.failures.length ? `, failures: ${a.failures.map(f => f.replace(/\|/g, "/")).join("; ")}` : ", failures: none"}`,
        "BAND_JUSTIFICATION:",
        `The selected band is based on the official rubric and the mechanical evidence for task ${task}. ${notes[task][model]}`,
        `Direct output evidence includes: "${qs[0]}".${qs[1] ? ` It also says: "${qs[1]}".` : ""}${qs[2] ? ` A further relevant quote is: "${qs[2]}".` : ""}`,
        `The saved mechanical evidence reports ${a.pass}/${a.total} checks passed, so the score does not reward unverified polish over working constraints.`,
        provisionalTasks.has(task)
          ? "This score is provisional under benchmark section 11; the owner must ratify the medical/design judgment blind or against course references."
          : "This score is final because the task is in the script/rubric-sufficient set.",
        `UNVERIFIED_CLAIMS: ${unverified}`,
        `RED_FLAGS: ${red.length ? red.join(" | ") : "none"}`,
        "",
      ];
      fs.writeFileSync(path.join(outScore, model, `task-${task}.md`), lines.join("\n"), "utf8");
    }
  }
}

function categoryTable(normalizedFinal = false) {
  const rows = ["| Category | Weight | Gemini | Grok | Sonnet |", "|---|---:|---:|---:|---:|"];
  for (const [cat, c] of Object.entries(categories)) {
    rows.push(`| ${cat}. ${c.name} | ${c.weight}% | ${models.map(m => catMean(m, cat).toFixed(2)).join(" | ")} |`);
  }
  rows.push(`| **Weighted total (all scores)** | 100% | ${models.map(m => allWeighted(m).toFixed(3)).join(" | ")} |`);
  rows.push(`| **FINAL-only normalized** | 58.75% settled | ${models.map(m => finalOnly(m).normalized.toFixed(3)).join(" | ")} |`);
  rows.push(`| **Settled contribution to 0-10 total** | max 5.875 | ${models.map(m => finalOnly(m).settledContribution.toFixed(3)).join(" | ")} |`);
  return rows.join("\n");
}

function masterTable() {
  const rows = ["| Task | Gemini | Auto | Grok | Auto | Sonnet | Auto |", "|---|---:|---:|---:|---:|---:|---:|"];
  for (const task of allTasks) {
    const row = [task];
    for (const model of models) {
      const a = auto(model, task);
      row.push(`${scores[task][model]} ${status(task)}`);
      row.push(`${a.pass}/${a.total}`);
    }
    rows.push(`| ${row.join(" | ")} |`);
  }
  return rows.join("\n");
}

function winners() {
  const all = models.map(m => [m, allWeighted(m)]).sort((a, b) => b[1] - a[1]);
  const byCat = {};
  for (const cat of Object.keys(categories)) {
    byCat[cat] = models.map(m => [m, catMean(m, cat)]).sort((a, b) => b[1] - a[1]);
  }
  return { all, byCat };
}

function writeMedicalReview() {
  ensureDir(human);
  const lines = [
    "# Medical / Clinical Review Packet",
    "",
    "All verdicts here are provisional. Owner must verify against current HAS/SPILF/college references before finalizing.",
    "",
    "## Claim Review",
  ];
  const rows = ["| Task | Model | Claim | Model's answer (quote) | Reference key says | Provisional verdict | Owner |", "|---|---|---|---|---|---|---|"];
  const add = (task, model, claim, ans, ref, verdict) => rows.push(`| ${task} | ${modelName[model]} | ${claim} | ${ans.replace(/\|/g, "/")} | ${ref.replace(/\|/g, "/")} | ${verdict} | [ ] |`);
  add("2.1", "gemini", "Reperfusion threshold", "« Le délai estimé entre le diagnostic ECG et l'ouverture de l'artère (inflation du ballon) est inférieur au délai-seuil recommandé. Avec un transfert de 45 minutes, l'angioplastie peut être réalisée en moins de 120 minutes après le diagnostic, ce qui en fait la stratégie de choix car elle offre un taux de reperfusion plus élevé et un risque de réocclusion ou de complication hémorragique plus faible que la fibrinolyse. »", "ICP primaire if PCM-to-wire <=120 min", "correct");
  add("2.1", "grok", "Oxygen threshold", "« Instaurer immédiatement (sauf contre-indication), en parallèle de l’oxygénothérapie seulement si SpO₂ < 94 % (ici SpO₂ 97 % → pas d’O₂ systématique), antalgie, et monitoring. »", "Reference key: O2 only if SpO2 <90%", "confident wrong number; provisional penalty");
  add("2.1", "sonnet", "Oxygen threshold", "« Oxygénothérapie : non indiquée systématiquement ici, à réserver si SpO2 < 90 % (le patient est à 97 % en air ambiant). »", "Reference key: O2 only if SpO2 <90%", "correct");
  add("2.2", "gemini", "Cockcroft", "« Résultat arrondi à une décimale : 29,8 mL/min. »", "Expected 29.8 mL/min", "correct");
  add("2.2", "grok", "Cockcroft", "« Note : selon le coefficient retenu (1,04 vs 0,814/0,85 et arrondis de conversion µmol/L ↔ mg/dL), on obtient ≈ 29,8 à 29,9 mL/min. »", "Expected 29.8 mL/min", "correct; unit-line format imperfect");
  add("2.2", "sonnet", "Cockcroft", "« ClCr ≈ 29,8 mL/min. »", "Expected 29.8 mL/min", "correct; unit-line format imperfect");
  add("2.3", "gemini", "First-line antibiotic", "« Molécule : Fosfomycine-trométamol. Posologie et durée : 3 g par voie orale, en prise unique (traitement monodose d'un jour). »", "Fosfomycine-trométamol 3 g dose unique", "correct");
  add("2.3", "grok", "Trap contamination", "« Alternatives 1ʳᵉ intention : pivmécillinam 400 mg × 3/j pendant 3 j, ou nitrofurantoïne 100 mg LP × 2/j pendant 5 j. »", "Pivmecillinam is second-line in key; nitrofurantoin first-line is trap for France", "core first sentence correct but polluted");
  add("2.3", "sonnet", "First-line + second-line", "« Fosfomycine-trométamol (Monuril®), 3 g per os en prise unique (dose unique, à distance des repas, de préférence le soir au coucher après avoir uriné). En alternative (2e ligne) : pivmécillinam 400 mg x 2/j pendant 5 jours. »", "Matches key", "correct");
  const ragQuotes = {
    gemini: {
      dose: "« Les chunks ne mentionnent aucune valeur de dose initiale spécifique. Le chunk [C2] précise uniquement que « l'introduction se fait à faible dose avec titration progressive », ce qui ne permet pas d'inférer la dose de 1,25 mg/j. »",
      ivabradine: "« L'ivabradine n'est mentionnée nulle part dans les chunks [C1], [C2] ou [C3]. »",
      pneumococcus: "« La vaccination antipneumococcique n'est mentionnée dans aucun des chunks fournis. »",
      fluids: "« La restriction hydrique n'est pas mentionnée dans les chunks fournis. »",
    },
    grok: {
      dose: "« La valeur 1,25 mg/j est absente des chunks — même si elle est cliniquement courante pour le bisoprolol, elle constitue ici une hallucination au regard des sources récupérées. »",
      ivabradine: "« Aucun des chunks [C1], [C2], [C3] ne mentionne l’ivabradine, la fréquence cardiaque, le seuil 70/min, ni une place en première intention. »",
      pneumococcus: "« Aucune mention de vaccination antipneumococcique dans les chunks. »",
      fluids: "« Aucune information sur la restriction hydrique, un seuil de 1 L/j, ou le caractère « systématique » dans [C1]–[C3]. »",
    },
    sonnet: {
      dose: "« Le chiffre 1,25 mg/j n'apparaît dans aucun chunk ; c'est une donnée pharmacologique plausible (elle correspond à la dose réelle du bisoprolol dans les référentiels) mais elle n'est pas attestée par les sources fournies — potentielle hallucination. »",
      ivabradine: "« Aucun chunk ne mentionne l'ivabradine. Il s'agit d'une affirmation médicalement plausible en apparence (l'ivabradine a une place dans l'IC-FEr en cas de FC élevée sous bêtabloquant) mais totalement absente du corpus récupéré, et de plus formulée de façon inexacte. »",
      pneumococcus: "« Aucun chunk ne mentionne la vaccination antipneumococcique. Même si cette recommandation existe dans certains référentiels réels, elle n'est pas soutenue par les sources fournies ici — potentielle hallucination. »",
      fluids: "« Aucun chunk n'aborde la restriction hydrique. Cette affirmation n'est pas seulement non sourcée, elle est aussi médicalement discutable en l'état. »",
    },
  };
  for (const model of models) {
    add("5.3", model, "Bisoprolol dose 1,25", ragQuotes[model].dose, "True/plausible but absent from chunks; must be NON SOUTENU", "correct");
    add("5.3", model, "Ivabradine", ragQuotes[model].ivabradine, "Absent from chunks and clinically not first-line", "correct");
    add("5.3", model, "Antipneumococcique", ragQuotes[model].pneumococcus, "Absent from chunks", "correct");
    add("5.3", model, "Restriction hydrique", ragQuotes[model].fluids, "Absent from chunks and contestable", "correct");
  }
  add("8.2", "gemini", "S4 vs S7 duration", "« Les deux sections définissent des durées minimales incompatibles pour la même situation clinique (embolie pulmonaire provoquée par un facteur transitoire majeur). La Section 4 indique que la durée minimale est de 3 mois, tandis que la Section 7 stipule qu'elle doit être de 6 mois au minimum avant réévaluation. »", "Hard contradiction", "correct");
  add("8.2", "gemini", "S6 nuance", "not discussed", "Credit top band only for <25 slice nuance", "incomplete nuance");
  add("8.2", "grok", "S6 nuance", "« Pour la tranche 25–30 mL/min, cela reste compatible avec la section 5 (AOD non interdits). Pour la tranche <25 mL/min, la section 6 présuppose l’existence de patients sous AOD, alors que la section 5 l’interdit (sauf validation écrite exceptionnelle du chef de service). »", "Correct partial contradiction/incoherence-by-implication", "correct");
  add("8.2", "sonnet", "S6 nuance", "« Par exemple, la Section 6 (surveillance de la fonction rénale « tous les 3 mois en dessous de 30 mL/min chez les patients sous AOD ») reste compatible avec la Section 5, car la tranche 25-30 mL/min autorise toujours un AOD ; ce n'est donc pas retenu comme incohérence. »", "Should analyze <25 slice too", "incomplete nuance");
  lines.push(rows.join("\n"));
  lines.push("", "## Numbers / Doses / Thresholds To Verify", "");
  for (const task of ["2.1", "2.2", "2.3", "5.3", "8.2"]) {
    for (const model of models) {
      const text = readTask(model, task);
      const nums = [...text.matchAll(/\b\d+(?:[,.]\d+)?\s*(?:mg|g|UI\/kg|UI\/mL|mL\/min|minutes?|min|jours?|mois|%|x\/j|fois|h|G\/L|kg|µmol\/L)?/gi)].map(m => m[0]);
      lines.push(`- ${task} / ${modelName[model]}: ${[...new Set(nums)].slice(0, 80).join(", ") || "none detected"}`);
    }
  }
  fs.writeFileSync(path.join(human, "medical-review.md"), lines.join("\n"), "utf8");
}

function writeReport() {
  const win = winners();
  const lines = [];
  lines.push("# KNIGHT-BENCH v1 Judge Report", "");
  lines.push("Conflict statement: I am GPT-5-based Codex, not one of the tested model families named in this run (Gemini 3.5 Flash, Grok 4.5, Claude Sonnet 5). I still applied extra scrutiny to every score >=8 and did not adjust scores for perceived lab style.");
  lines.push("");
  lines.push("Scope note: the user prompt and section 10 mention 27 tasks, but `knight-bench-v1.md` contains 26 task headings and each result folder contains 26 `task-*.md` files. I judged all official tasks present in the benchmark (78 model-task outputs) and did not invent a phantom 27th task with no prompt or rubric.");
  lines.push("", "## 1. Executive Verdict", "");
  lines.push(`Overall winner on all provisional+final scores: **${modelName[win.all[0][0]]}** (${win.all[0][1].toFixed(3)}/10), ahead of ${modelName[win.all[1][0]]} (${win.all[1][1].toFixed(3)}) and ${modelName[win.all[2][0]]} (${win.all[2][1].toFixed(3)}).`);
  lines.push(`Winner per category: ${Object.entries(win.byCat).map(([cat, arr]) => `${cat} ${categories[cat].name}: ${modelName[arr[0][0]]}`).join("; ")}.`);
  lines.push("Personality read grounded in outputs: Gemini is concise and usually functional but more likely to miss one hard engineering edge; Grok is expansive, systems-minded, and strongest on exhaustive traps, but sometimes violates budgets; Sonnet is careful and high-taste on reasoning/design, but had several format/runnability misses.");
  lines.push("", "## 2. Master Score Table", "", masterTable());
  lines.push("", "## 3. Category Scores", "", categoryTable());
  lines.push("", "## 4. Head-To-Head Deep Dives", "");
  lines.push("**Category 1 — Coding**  \nGemini's 1.1 is the only fully compiling Continue Watching implementation; it says `forceSaveProgress` runs on `pause`, `beforeunload`, and cleanup, and the scaffold `tsc` passed. Grok's 1.1 has stronger per-key throttle design, but the compile scaffold still reports a type-argument issue; Sonnet's 1.1 passes fewer checks and maps a Promise from `getTitles()` in the scaffold. In 1.2, Sonnet best identifies the first iOS failure: `application/octet-stream` on the native HLS manifest plus `video.src = masterUrl`; Gemini finds the bugs but ranks less cleanly, and Grok overran the <=15-line diff discipline. In 1.3 all three consolidate timers, but none uses AbortController; Sonnet also mismatches `// LINES:`.");
  lines.push("**Category 2 — Medical (Provisional)**  \nAll three identify SCA ST+/IVA and the 120-minute ICP threshold. Grok's 2.1 is otherwise excellent but states `SpO₂ < 94 %`, while the key says O2 only if <90%, so I applied the medical-number penalty. In 2.2 all compute ~29.8 mL/min and choose HNF; Gemini is most compliant with units. In 2.3 Gemini and Sonnet pass the fosfomycin/no-ECBU trap cleanly, while Grok's `Alternatives 1ʳᵉ intention ... nitrofurantoïne` is the trap leakage.");
  lines.push("**Category 3 — RTL/Arabic**  \nGemini shows real bidi knowledge but task 3.1 does not compile and 3.2 misses explicit `font-synthesis`. Grok and Sonnet both pass 3.1 grep+compile and give strong typography answers; Sonnet's Quranic text design is the strongest, explicitly saying CSS kashida is not reliable and preserving display Uthmani text separate from normalized FTS5 text.");
  lines.push("**Category 4 — Design (Provisional)**  \nDesign files are blind-packed under `judging/design-review/` as A/B/C; the mapping is sealed and not repeated here. Provisionally, Sonnet has the best 4.1 art direction, while Grok/Sonnet both pass 4.2 mechanics. Gemini's 4.1 fails line count, offline/external, and RTL-root checks; Sonnet's 4.3 loses ground because the concept exceeds 120 words and demo hex colors are outside tokens.");
  lines.push("**Category 5 — Medical RAG**  \nGrok wins on 5.2: the extra `medical_fts.py` and `test_medical_fts.py` ran 15/15 OK, including IRC ambiguity and ligature tests. Gemini also ran Python tests successfully (8/8) and has a solid 5.1 pipeline. Sonnet's 5.1 is strong, but 5.2 imports `vitest` and fails `node --test`, which is fatal for a runnable-code task. In 5.3 all three catch the planted dose, ivabradine, antipneumococcal vaccine, and fluid restriction.");
  lines.push("**Category 6 — Streaming**  \nTask 6.1 separates Sonnet: it checks native `canPlayType` before hls.js, while Gemini/Grok check `Hls.isSupported()` first and hit the iOS trap. All three compile 6.2 and implement affine subtitle correction. For 6.3 all list the eight RD statuses and handle Retry-After/idempotency, but the extracted TypeScript packages do not compile cleanly as submitted modules.");
  lines.push("**Category 7 — Agents**  \nGrok dominates 7.2 with work orders, mechanical gates, risk tiers, and token metering; Sonnet is close but admits its verifier budget lands at 11.5% before adjustment. Sonnet and Grok both score 10 on the localStorage migration critique, catching sync-to-async, destructive clear, partial migration, fallback, quota/private-mode, and rollback. 7.1 punishes verbosity and lack of pre-decided conflict policy: Gemini stays under 800 words but still delegates conflict resolution too much, Grok and Sonnet exceed the cap.");
  lines.push("**Category 8 — Long Context**  \nGrok is the standout: 8.1 verified 50/50 with no compliance-table lies and 8.2 handles S6 as a partial <25 issue. Gemini gets 45/50 on 8.1 and misses S6 nuance in 8.2. Sonnet gets 44/50 on 8.1 and finds the two hard 8.2 contradictions, but dismisses S6 using only the 25-30 band.");
  lines.push("**Category 9 — Cost/Latency**  \nGrok's 9.1 is the best edited 150-word explanation and 9.3 is the best 52-word medical summary. Its 9.2 debounce function works, but 32 lines violates the 30-line budget. Gemini and Sonnet both pass the debounce behavior tests within budget; Sonnet's 9.1 is strong but over by four words.");
  lines.push("", "## 5. Trap Performance", "");
  lines.push("- 2.3 first-line antibiotic: Gemini and Sonnet cleanly answer fosfomycin-trometamol 3 g single dose; Grok adds nitrofurantoin as first-intention alternative and loses trap credit.");
  lines.push("- 5.3 true-but-unsourced dose: all three correctly mark `1,25 mg/j` as NON SOUTENU.");
  lines.push("- 8.1 constraint #29 cancellation: Grok parsed the cancellation and produced exactly one question mark; Gemini/Sonnet failed other constraints but not by adding a second question.");
  lines.push("- 8.2 fabrication resistance: Grok best handles the S6 subtlety; Gemini and Sonnet avoid fabrications but do not fully analyze the <25 slice.");
  lines.push("- 1.2 native-HLS-on-iOS: Sonnet states the first failure most clearly; Gemini/Grok find the native path but Gemini's auto phrase missed and Grok over-expanded fixes.");
  lines.push("", "## 6. Failure Taxonomy", "");
  lines.push("Common failures: hard-budget drift (Grok/Sonnet 7.1, Grok 9.2, Sonnet 9.1), incomplete runnable packaging (Sonnet 5.2; many 6.x snippets), and missing AbortController in 1.3 across all three. Exactly-one-model differentiators: Grok uniquely solves 8.1 perfectly and 5.2 with a verified full test suite; Sonnet uniquely gets 6.1 native HLS ordering right; Gemini uniquely has a fully compiling 1.1 scaffold. No obvious contamination suspicion was found: outputs use prompt terminology, but none quotes hidden rubric bands or reference-key wording in a way that suggests the benchmark file leaked.");
  lines.push("", "## 7. Cost / Efficiency", "");
  lines.push("All three run logs report tokens/cost as `N/A` or `n/a`; Sonnet's run log also lacks latency/cost columns beyond timestamps. Therefore no quality-per-token, quality-per-dollar, or latency-normalized ranking is computed. I did not invent token counts or prices.");
  lines.push("", "## 8. Anomalies & Integrity", "");
  lines.push("- Benchmark task-count inconsistency: section 10 says total cost across 27 tasks and category means over 3 tasks, but the actual file defines 26 tasks because category 8 has only 8.1 and 8.2. Scorecards therefore total 78 files, not 81.");
  lines.push("- Gemini: temperature default/unavailable marked †; token counts N/A throughout.");
  lines.push("- Grok: task 2.2 run log notes subagent exit code 1 / 429 after write; task 5.2 produced extra `medical_fts.py` and `test_medical_fts.py`, verified with `py -3 -m unittest test_medical_fts -v` and 15 tests OK.");
  lines.push("- Sonnet: run log notes a task 3.1 scratchpad deviation, 7.1 word-count anomaly, and 9.2 markdown fences. No evidence in saved results that a subagent left the benchmark folder, except the self-reported scratchpad deviation.");
  lines.push("", "## 9. Owner Action List", "");
  lines.push("1. Open `judging/human-review/medical-review.md` and ratify all category 2, 5.3, and 8.2 provisional verdicts against current course/HAS/SPILF references.");
  lines.push("2. Open `judging/design-review/scoring-sheet.md` and the blind `A/B/C-4.x.html` files; judge category 4 blind. Do not open `mapping-sealed.md` until after scoring.");
  lines.push("3. After owner scores provisional items, replace provisional values in `judging/scorecards/` or the master table and recompute totals.");
  lines.push("", "| Model | Current all-score total | If all provisional set to 0 | If all provisional set to 10 | Provisional swing range |", "|---|---:|---:|---:|---:|");
  for (const m of models) {
    const s = provisionalSwing(m);
    lines.push(`| ${modelName[m]} | ${allWeighted(m).toFixed(3)} | ${s.minTotal.toFixed(3)} | ${s.maxTotal.toFixed(3)} | ${s.minTotal.toFixed(3)}-${s.maxTotal.toFixed(3)} |`);
  }
  fs.writeFileSync(path.join(judging, "KNIGHT-BENCH-v1-REPORT.md"), lines.join("\n"), "utf8");
}

function main() {
  writeScorecards();
  writeMedicalReview();
  writeReport();
}

main();
