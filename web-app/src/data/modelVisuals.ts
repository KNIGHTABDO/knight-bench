import type { JudgedModelId, ModelId } from "./types";

export const modelColorVar: Record<ModelId, string> = {
  gemini: "var(--series-gemini)",
  grok: "var(--series-grok)",
  sonnet: "var(--series-sonnet)",
  muse: "var(--series-muse)",
  gpt55: "var(--series-gpt55)",
};

export const modelShortName: Record<ModelId, string> = {
  gemini: "Gemini 3.5 Flash",
  grok: "Grok 4.5",
  sonnet: "Claude Sonnet 5",
  muse: "Muse Spark 1.1",
  gpt55: "GPT-5.5",
};

/** Drives score tables, charts, and per-task evidence tabs. */
export const modelOrder: JudgedModelId[] = ["gemini", "grok", "sonnet", "muse", "gpt55"];
