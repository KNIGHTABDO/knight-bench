import type { MasterScoreRow, CategoryScoreRow } from "./types";

export const conflictStatement =
  "The original three models (Gemini 3.5 Flash, Grok 4.5, Claude Sonnet 5) were judged by GPT-5-based Codex. Muse Spark 1.1 was judged separately by Claude Fable 5. GPT-5.5 was judged by GPT-5-based Codex, the same model family as the subject: treat its entire result as conflict-provisional pending an independent re-score. The muse-spark-1.1 run log also suggests a possible Claude-family subject judged by a Claude-family model, so its first place remains provisional. Every score >=9 added in this cycle is tied to a compile, run, grep, word count, or scripted constraint result; Cat 2 / Cat 4 / 5.3 / 8.2 / 9.3 medical and design tasks also remain owner-provisional.";

export const scopeNote =
  "The user prompt and section 10 mention 27 tasks, but knight-bench-v1.md contains 26 task headings and each result folder contains 26 task-*.md files. Five models are now scored (130 model-task outputs): Gemini, Grok, Sonnet, Muse, and GPT-5.5. No phantom 27th task was invented.";

export const executiveVerdict = {
  winner: "muse" as const,
  summary:
    "Overall winner on all provisional+final scores: Muse Spark 1.1 (8.283/10), ahead of GPT-5.5 (7.796), Grok 4.5 (7.767), Claude Sonnet 5 (7.529), and Gemini 3.5 Flash (7.208). GPT-5.5 is conflict-provisional because it was scored by a GPT-family judge; Muse's lead also rests partly on owner-pending medical and design scores.",
  categoryWinners: [
    { categoryId: 1, model: "muse" as const },
    { categoryId: 2, model: "muse" as const },
    { categoryId: 3, model: "sonnet" as const },
    { categoryId: 4, model: "muse" as const },
    { categoryId: 5, model: "grok" as const },
    { categoryId: 6, model: "sonnet" as const },
    { categoryId: 7, model: "muse" as const },
    { categoryId: 8, model: "grok" as const },
    { categoryId: 9, model: "muse" as const },
  ],
  personalityRead:
    "Gemini is concise and usually functional but more likely to miss one hard engineering edge; Grok is expansive and systems-minded but sometimes violates budgets; Sonnet is careful and high-taste on reasoning/design but has format and runnable-code misses; Muse is the most consistent all-rounder; GPT-5.5 is notably strong on Arabic text, HLS diagnosis, citation verification, and migration critique, but its FTS5 code fails its supplied tests and it loses hard-constraint points in 8.1 and 9.2.",
};

export const masterScoreTable: MasterScoreRow[] = [
  { taskId: "1.1", gemini: { score: 8, status: "FINAL", autoChecksPassed: 6, autoChecksTotal: 6 }, grok: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 6 }, sonnet: { score: 6, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 6 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 6, autoChecksTotal: 6 }, gpt55: { score: 6, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 6 } },
  { taskId: "1.2", gemini: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 }, grok: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 5 }, sonnet: { score: 9, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, gpt55: { score: 9, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 } },
  { taskId: "1.3", gemini: { score: 6, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 7 }, grok: { score: 6, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 7 }, sonnet: { score: 4, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 7 }, muse: { score: 6, status: "FINAL", autoChecksPassed: 6, autoChecksTotal: 6 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 7, autoChecksTotal: 7 } },
  { taskId: "2.1", gemini: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, grok: { score: 7, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "2.2", gemini: { score: 9, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, grok: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, sonnet: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, muse: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 7, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 } },
  { taskId: "2.3", gemini: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 3 }, grok: { score: 6, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 3 }, sonnet: { score: 9, status: "PROVISIONAL", autoChecksPassed: 2, autoChecksTotal: 3 }, muse: { score: 9, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 3 }, gpt55: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 3 } },
  { taskId: "3.1", gemini: { score: 6, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "3.2", gemini: { score: 7, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 3 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, sonnet: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, gpt55: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 } },
  { taskId: "3.3", gemini: { score: 7, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "4.1", gemini: { score: 4, status: "PROVISIONAL", autoChecksPassed: 2, autoChecksTotal: 5 }, grok: { score: 5, status: "PROVISIONAL", autoChecksPassed: 2, autoChecksTotal: 5 }, sonnet: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, muse: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, gpt55: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 } },
  { taskId: "4.2", gemini: { score: 6, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, grok: { score: 8, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 }, sonnet: { score: 8, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 }, muse: { score: 6, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, gpt55: { score: 6, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 5 } },
  { taskId: "4.3", gemini: { score: 6, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, grok: { score: 7, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, sonnet: { score: 5, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 5 }, muse: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 5 }, gpt55: { score: 9, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 } },
  { taskId: "5.1", gemini: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, sonnet: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "5.2", gemini: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, grok: { score: 10, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, sonnet: { score: 4, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 }, muse: { score: 6, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 5 }, gpt55: { score: 2, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 } },
  { taskId: "5.3", gemini: { score: 8, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 }, grok: { score: 9, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 }, sonnet: { score: 9, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 }, muse: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 10, status: "PROVISIONAL", autoChecksPassed: 5, autoChecksTotal: 5 } },
  { taskId: "6.1", gemini: { score: 5, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 4 }, grok: { score: 5, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 4 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "6.2", gemini: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, grok: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, sonnet: { score: 9, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 } },
  { taskId: "6.3", gemini: { score: 7, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 }, grok: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 } },
  { taskId: "7.1", gemini: { score: 5, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 }, grok: { score: 4, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 4 }, sonnet: { score: 4, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 4 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 6, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 4 } },
  { taskId: "7.2", gemini: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, grok: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "7.3", gemini: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, grok: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 10, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
  { taskId: "8.1", gemini: { score: 6, status: "FINAL", autoChecksPassed: 45, autoChecksTotal: 50 }, grok: { score: 10, status: "FINAL", autoChecksPassed: 50, autoChecksTotal: 50 }, sonnet: { score: 5, status: "FINAL", autoChecksPassed: 44, autoChecksTotal: 50 }, muse: { score: 10, status: "FINAL", autoChecksPassed: 50, autoChecksTotal: 50 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 49, autoChecksTotal: 50 } },
  { taskId: "8.2", gemini: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, grok: { score: 10, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 }, sonnet: { score: 8, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 8, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 3 }, gpt55: { score: 7, status: "PROVISIONAL", autoChecksPassed: 3, autoChecksTotal: 4 } },
  { taskId: "9.1", gemini: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 3 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, gpt55: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 } },
  { taskId: "9.2", gemini: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, grok: { score: 6, status: "FINAL", autoChecksPassed: 2, autoChecksTotal: 3 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 3, autoChecksTotal: 3 }, muse: { score: 9, status: "FINAL", autoChecksPassed: 5, autoChecksTotal: 5 }, gpt55: { score: 6, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 5 } },
  { taskId: "9.3", gemini: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, grok: { score: 9, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, sonnet: { score: 8, status: "FINAL", autoChecksPassed: 4, autoChecksTotal: 4 }, muse: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 }, gpt55: { score: 9, status: "PROVISIONAL", autoChecksPassed: 4, autoChecksTotal: 4 } },
];

export const categoryScoreTable: CategoryScoreRow[] = [
  { categoryId: 1, gemini: 7.33, grok: 7.33, sonnet: 6.33, muse: 7.67, gpt55: 7.67 },
  { categoryId: 2, gemini: 8.33, grok: 7.0, sonnet: 8.33, muse: 9.0, gpt55: 8 },
  { categoryId: 3, gemini: 6.67, grok: 9.0, sonnet: 9.33, muse: 9.0, gpt55: 9 },
  { categoryId: 4, gemini: 5.33, grok: 6.67, sonnet: 7.0, muse: 7.67, gpt55: 7.67 },
  { categoryId: 5, gemini: 8.0, grok: 9.33, sonnet: 7.33, muse: 7.67, gpt55: 6.67 },
  { categoryId: 6, gemini: 6.67, grok: 7.0, sonnet: 8.33, muse: 8.0, gpt55: 8 },
  { categoryId: 7, gemini: 7.0, grok: 8.0, sonnet: 7.33, muse: 9.0, gpt55: 8.33 },
  { categoryId: 8, gemini: 7.0, grok: 10.0, sonnet: 6.5, muse: 9.0, gpt55: 7.5 },
  { categoryId: 9, gemini: 8.0, grok: 8.0, sonnet: 8.0, muse: 9.0, gpt55: 7.67 },
];

export const deepDives: { categoryId: number; title: string; text: string }[] = [
  {
    categoryId: 1,
    title: "Category 1 — Coding",
    text: "GPT-5.5 ties the strongest 1.2 diagnosis: it ranks the raw iOS fallback, 206 destruction, MIME type, manifest-child, MP4 classification, and CORS failures, but its 1.1 scaffold has real page-type errors. Gemini remains the only fully compiling Continue Watching implementation. GPT-5.5's 1.3 uses AbortController and preserves the JSX structure, while the original three all miss the abort mechanism. The category stays tied between Muse and GPT-5.5 at 7.67, so the existing winner is retained.",
  },
  {
    categoryId: 2,
    title: "Category 2 — Medical (Provisional)",
    text: "GPT-5.5 correctly gives the SCA ST+/IVA diagnosis, 120-minute ICP threshold, oxygen only below 90%, fosfomycin 3 g single-dose, and no routine ECBU. Its Cockcroft answer is clinically cautious and complete but has invalid units on intermediate arithmetic lines, which prevents a top score. Grok still loses trap credit by offering nitrofurantoin as first intention. All category scores remain owner-provisional.",
  },
  {
    categoryId: 3,
    title: "Category 3 — RTL/Arabic",
    text: "GPT-5.5 joins the top tier in Arabic engineering: its composer compiles with first-strong direction detection and bidi isolation, its typography review covers OpenType shaping and synthetic-weight hazards, and its Quran design separates Uthmani display text from normalized external-content FTS5 search. Sonnet remains category leader at 9.33. GPT-5.5's Quran answer is especially complete on word-joiners, mark ranges, and refusing CSS-only kashida claims.",
  },
  {
    categoryId: 4,
    title: "Category 4 — Design (Provisional)",
    text: "Design files are blind-packed under judging/design-review/ as A/B/C/D/E; the mapping is sealed and not repeated here. GPT-5.5's MADAR concept has distinctive cinematic Arabic art direction but misses the 600-line cap, and its now-playing component violates its own no-per-frame-state performance strategy. Its SIRAJ identity is the strongest of its three design entries: concept, tokens, typography, motion, and demo align. The category is tied with Muse at 7.67, so the existing winner is retained pending blind owner review.",
  },
  {
    categoryId: 5,
    title: "Category 5 — Medical RAG",
    text: "GPT-5.5's 5.1 design is a strong FTS5/BM25-only multi-hop plan with metadata filtering, deterministic stopping criteria, accent handling, and abbreviation expansion. Its 5.2 code is a decisive failure: all 12 supplied tests error with a malformed FTS database during the delete path. Its 5.3 verifier correctly rejects the true-but-unsourced dose and other unsupported claims, but that medical task remains provisional. Grok retains the category lead through its verified 5.2 implementation.",
  },
  {
    categoryId: 6,
    title: "Category 6 — Streaming",
    text: "GPT-5.5 gets native `canPlayType` ordering right in 6.1, gives a robust affine and overlap-aware subtitle implementation in 6.2, and handles all Real-Debrid states, Retry-After, idempotency, and Durable Object limiting in 6.3. Its 6.1 and 6.3 source modules compile after the judge excludes prose/config examples and supplies only missing scaffold declarations. It scores a consistent 8.00 but does not displace Sonnet's 8.33 category lead.",
  },
  {
    categoryId: 7,
    title: "Category 7 — Agents",
    text: "GPT-5.5's 7.2 has a detailed work-order schema, specific mechanical gates, calibrated risk sampling, and corrected 10-80-10 accounting. Its 7.3 is a top-tier migration critique that catches sync/async breakage, destructive cleanup, multi-tab races, fallback, telemetry, and staged rollback. Its 7.1 stays under 800 words but leaves conflict choice to the implementing agent, so it scores only 6 there. Muse remains the category leader.",
  },
  {
    categoryId: 8,
    title: "Category 8 — Long Context",
    text: "GPT-5.5 gets 49/50 on the constrained announcement, missing only the exactly-one-written-number constraint by using both `zero` and `three`; its compliance table remains honest. It finds the two hard anticoagulation protocol contradictions but misses the section-6 25-30 versus below-25 nuance and repeats the duration issue as a third entry. Grok remains the clear category leader with a perfect 8.1 and full section-6 reasoning.",
  },
  {
    categoryId: 9,
    title: "Category 9 — Cost/Latency",
    text: "GPT-5.5's 139-word SSR/SSG/ISR/streaming explanation is accurate and decision-oriented, and its 56-word French medical summary preserves every critical fact. Its debounce implementation passes direct behavior tests but is 31 lines, so it receives only a 6 for that task. Muse retains the category lead, though GPT-5.5's 7.67 average is competitive.",
  },
];

export const trapPerformance: { taskId: string; text: string }[] = [
  { taskId: "2.3", text: "First-line antibiotic: Gemini and Sonnet cleanly answer fosfomycin-trometamol 3 g single dose; Grok adds nitrofurantoin as first-intention alternative and loses trap credit." },
  { taskId: "5.3", text: "True-but-unsourced dose: all four models correctly mark \"1,25 mg/j\" as NON SOUTENU; GPT-5.5 also supplies a clean supported rewrite." },
  { taskId: "8.1", text: "Constraint #29 cancellation: GPT-5.5 and Grok parse the cancellation and produce exactly one question mark. GPT-5.5 loses one separate point by using both \"zero\" and \"three\" as written numbers." },
  { taskId: "8.2", text: "Fabrication resistance: Grok best handles the S6 subtlety; Gemini and Sonnet avoid fabrications but do not fully analyze the <25 slice." },
  { taskId: "1.2", text: "Native-HLS-on-iOS: GPT-5.5 and Sonnet both identify the native fallback and wrong manifest/media handling; GPT-5.5 adds minimal diffs for Range, MIME, manifest rewriting, and MP4 classification." },
];

export const failureTaxonomy =
  "Common failures: hard-budget drift (Grok/Sonnet 7.1, Grok and GPT-5.5 9.2, Sonnet 9.1), incomplete runnable packaging (Sonnet and GPT-5.5 5.2), and strict design-mechanics misses. Differentiators: Grok uniquely solves 8.1 perfectly and 5.2 with a verified full test suite; Sonnet and GPT-5.5 get native HLS ordering right; Gemini uniquely has a fully compiling 1.1 scaffold; GPT-5.5 uniquely combines a top-tier Quranic design with a strong Real-Debrid Worker state machine. No obvious raw-answer contamination marker was found, but the original GPT-5.5 execution lacked transcript access for a complete tool-log audit.";

export const costEfficiencyNote =
  "All five run logs report tokens/cost as N/A or n/a, including GPT-5.5. Therefore no quality-per-token, quality-per-dollar, or latency-normalized ranking is computed. No token counts or prices were invented.";

export const anomalies = [
  "Benchmark task-count inconsistency: section 10 says total cost across 27 tasks and category means over 3 tasks, but the actual file defines 26 tasks because category 8 has only 8.1 and 8.2. Scorecards therefore total 130 files, not 135.",
  "Gemini: temperature default/unavailable marked †; token counts N/A throughout.",
  "Grok: task 2.2 run log notes subagent exit code 1 / 429 after write; task 5.2 produced extra medical_fts.py and test_medical_fts.py, verified with `py -3 -m unittest test_medical_fts -v` and 15 tests OK.",
  "Sonnet: run log notes a task 3.1 scratchpad deviation, 7.1 word-count anomaly, and 9.2 markdown fences. No evidence in saved results that a subagent left the benchmark folder, except the self-reported scratchpad deviation.",
  "GPT-5.5: temperature control and hard worker filesystem confinement were unavailable; task 6.3 retried after a provider limit before any write; thread capacity required closing completed workers before task 9.1. The original run's transcript-level audit was unavailable. Its 5.2 supplied Python suite failed 12/12; 6.1 and 6.3 compile after documented scratch-only harness corrections.",
];

export const ownerActionList = [
  "Open judging/human-review/medical-review.md and ratify all category 2, 5.3, and 8.2 provisional verdicts against current course/HAS/SPILF references.",
  "Open judging/design-review/scoring-sheet.md and the blind A/B/C/D/E-4.x.html files; judge category 4 blind. Do not open mapping-sealed.md until after scoring.",
  "Obtain an independent non-GPT-family re-score for GPT-5.5 before treating its total or rank as settled.",
  "After owner scores provisional items, replace provisional values in judging/scorecards/ or the master table and recompute totals.",
];

export const provisionalSwing = [
  { model: "gemini" as const, current: 7.208, ifZero: 4.242, ifTen: 8.367 },
  { model: "grok" as const, current: 7.767, ifZero: 4.792, ifTen: 8.917 },
  { model: "sonnet" as const, current: 7.529, ifZero: 4.263, ifTen: 8.388 },
  { model: "muse" as const, current: 8.283, ifZero: 4.758, ifTen: 8.967 },
  { model: "gpt55" as const, current: 7.796, ifZero: 4.383, ifTen: 8.592 },
];
