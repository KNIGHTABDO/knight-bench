import type { ModelId } from "./types";

export const modelColorVar: Record<ModelId, string> = {
  gemini: "var(--series-gemini)",
  grok: "var(--series-grok)",
  sonnet: "var(--series-sonnet)",
};

export const modelShortName: Record<ModelId, string> = {
  gemini: "Gemini 3.5 Flash",
  grok: "Grok 4.5",
  sonnet: "Claude Sonnet 5",
};

export const modelOrder: ModelId[] = ["gemini", "grok", "sonnet"];
