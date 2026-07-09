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

export type ModelId = "gemini" | "grok" | "sonnet";

export interface ModelInfo {
  id: ModelId;
  name: string;
  fullName: string;
  resultsDir: string;
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
}

export interface CategoryScoreRow {
  categoryId: number;
  gemini: number;
  grok: number;
  sonnet: number;
}
