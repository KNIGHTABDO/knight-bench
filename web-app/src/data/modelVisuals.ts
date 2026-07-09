import type { JudgedModelId, ModelId } from "./types";

export const modelColorVar: Record<ModelId, string> = {
  gemini: "var(--series-gemini)",
  grok: "var(--series-grok)",
  sonnet: "var(--series-sonnet)",
  muse: "var(--series-muse)",
};

export const modelShortName: Record<ModelId, string> = {
  gemini: "Gemini 3.5 Flash",
  grok: "Grok 4.5",
  sonnet: "Claude Sonnet 5",
  muse: "Muse Spark 1.1",
};

/** Judged models only — drives score tables, charts, and per-task evidence tabs. */
export const modelOrder: JudgedModelId[] = ["gemini", "grok", "sonnet"];
