export interface RubricBand {
  range: string;
  text: string;
}

export interface Task {
  id: string;
  categoryId: number;
  title: string;
  prompt: string;
  rubric: RubricBand[];
  bluffPenalty?: string;
  scoringFormula?: string;
  autoChecks: string[];
  estimatedTokens: string;
}

export interface Category {
  id: number;
  name: string;
  weightPercent: number;
  description: string;
  winner: ModelId;
}

/** All models with saved results. As of the muse-spark-1.1 judging cycle, all are judged. */
export type ModelId = "gemini" | "grok" | "sonnet" | "muse" | "gpt55";

/** Retained for callers that distinguished judged vs raw-run models. */
export type JudgedModelId = ModelId;

export interface ModelInfo {
  id: ModelId;
  name: string;
  fullName: string;
  resultsDir: string;
  /** false = raw run complete, judging pending; score fields are placeholders. */
  judged: boolean;
  weightedTotal: number;
  finalOnlyNormalized: number;
  settledContribution: number;
  provisionalIfZero: number;
  provisionalIfTen: number;
}

export interface TaskScore {
  score: number;
  status: "FINAL" | "PROVISIONAL";
  autoChecksPassed: number;
  autoChecksTotal: number;
}

export interface MasterScoreRow {
  taskId: string;
  gemini: TaskScore;
  grok: TaskScore;
  sonnet: TaskScore;
  muse: TaskScore;
  gpt55: TaskScore;
}

export interface CategoryScoreRow {
  categoryId: number;
  gemini: number;
  grok: number;
  sonnet: number;
  muse: number;
  gpt55: number;
}
