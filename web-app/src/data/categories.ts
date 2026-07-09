import type { Category } from "./types";

export const categories: Category[] = [
  {
    id: 1,
    name: "Agentic Coding",
    weightPercent: 20,
    description:
      "Does the model explore and plan before writing code, respect constraints, and produce working diffs — or does it hallucinate file structure and vomit code immediately?",
    winner: "gemini",
  },
  {
    id: 2,
    name: "Medical Reasoning (French/EDN)",
    weightPercent: 20,
    description:
      "Clinical accuracy in French, correct terminology (the terminology *is* the exam), showing work with units, and — critically — refusing to bluff.",
    winner: "gemini",
  },
  {
    id: 3,
    name: "RTL/Arabic Engineering",
    weightPercent: 10,
    description:
      "Real bidi/typography competence, not \"add dir=rtl and pray\".",
    winner: "sonnet",
  },
  {
    id: 4,
    name: "Frontend Design Taste",
    weightPercent: 15,
    description:
      "Does it produce work in the Active Theory / Unseen / Studio Freight lineage, or default AI slop? Judged blind. Instant penalties (−2 each, stackable): purple-to-blue gradient hero, emoji in headings, default shadcn look presented as \"premium\", glassmorphism cards on a generic dark background, \"Inter for everything\".",
    winner: "sonnet",
  },
  {
    id: 5,
    name: "Medical RAG / Retrieval",
    weightPercent: 15,
    description:
      "Retrieval engineering competence on the real stack (SQLite FTS5, BM25, French medical corpora) — not vector-DB blog regurgitation.",
    winner: "grok",
  },
  {
    id: 6,
    name: "Streaming / Media Infra",
    weightPercent: 5,
    description: "HLS playback correctness, subtitle sync math, and Real-Debrid API integration under Workers constraints.",
    winner: "sonnet",
  },
  {
    id: 7,
    name: "Agent Orchestration",
    weightPercent: 10,
    description:
      "Writing briefs and multi-agent plans other agents will actually follow, and catching production-breaking flaws in a bad plan.",
    winner: "grok",
  },
  {
    id: 8,
    name: "Long-Context + Instruction Following",
    weightPercent: 2.5,
    description:
      "Exact compliance under many simultaneous, interacting constraints, and resistance to fabricating contradictions that aren't there.",
    winner: "grok",
  },
  {
    id: 9,
    name: "Cost/Latency Awareness",
    weightPercent: 2.5,
    description:
      "Quality per token under a hard word/line budget. The category where cheap models get to win.",
    winner: "gemini",
  },
];

export const categoryById = (id: number) => categories.find((c) => c.id === id)!;
