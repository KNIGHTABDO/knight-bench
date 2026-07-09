import type { ModelInfo } from "./types";

export const models: ModelInfo[] = [
  {
    id: "gemini",
    name: "Gemini 3.5 Flash",
    fullName: "Gemini 3.5 Flash",
    resultsDir: "gemini-3.5-flash-results",
    judged: true,
    weightedTotal: 7.208,
    finalOnlyNormalized: 7.22,
    settledContribution: 4.242,
    provisionalIfZero: 4.242,
    provisionalIfTen: 8.367,
  },
  {
    id: "grok",
    name: "Grok 4.5",
    fullName: "Grok 4.5",
    resultsDir: "grok-4.5-results",
    judged: true,
    weightedTotal: 7.767,
    finalOnlyNormalized: 8.156,
    settledContribution: 4.792,
    provisionalIfZero: 4.792,
    provisionalIfTen: 8.917,
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 5",
    fullName: "Claude Sonnet 5",
    resultsDir: "sonnet-5-results",
    judged: true,
    weightedTotal: 7.529,
    finalOnlyNormalized: 7.255,
    settledContribution: 4.263,
    provisionalIfZero: 4.263,
    provisionalIfTen: 8.388,
  },
  {
    // Raw run complete 2026-07-09 (26/26); judging not yet performed —
    // score fields are placeholders, never display them as real scores.
    id: "muse",
    name: "Muse Spark 1.1",
    fullName: "Muse Spark 1.1",
    resultsDir: "muse-spark-1.1-results",
    judged: false,
    weightedTotal: 0,
    finalOnlyNormalized: 0,
    settledContribution: 0,
    provisionalIfZero: 0,
    provisionalIfTen: 0,
  },
];

export const judgedModels = models.filter((m) => m.judged);

export const modelById = (id: string) => models.find((m) => m.id === id)!;

/** All models under test in KNIGHT-BENCH v1, per the spec — not all were run this cycle. */
export const modelsUnderTestV1 = [
  "Claude Fable 5",
  "GPT-5.6",
  "Gemini 3.5 Flash",
  "Grok 4.5",
  "GLM 5.2",
  "Muse Spark",
  "+ any future release",
];
