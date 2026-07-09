/**
 * Data-driven medical abbreviation table for French clinical text.
 *
 * Each entry maps an uppercase abbreviation to one or more candidate
 * expansions. Ambiguous abbreviations (more than one clinically plausible
 * expansion) are modeled explicitly with multiple candidates rather than
 * picking a single "best guess" — see design doc section 1.3.
 */

export interface AbbreviationCandidate {
  expansion: string;
  /** Rough relative prior likelihood in general French clinical text, 0-1. Not a calibrated probability — a documented editorial judgment call, used only to order candidates for display / tie-breaking, not to drop any candidate from OR-expansion. */
  weight: number;
  domain: string;
}

export interface AbbreviationEntry {
  abbreviation: string;
  candidates: AbbreviationCandidate[];
  ambiguous: boolean;
}

const RAW_TABLE: Array<[string, Array<[string, number, string]>]> = [
  ["IDM", [["infarctus du myocarde", 1.0, "cardiologie"]]],
  ["BPCO", [["bronchopneumopathie chronique obstructive", 1.0, "pneumologie"]]],
  ["AVC", [["accident vasculaire cerebral", 1.0, "neurologie"]]],
  ["HTA", [["hypertension arterielle", 1.0, "cardiologie"]]],
  [
    "IRC",
    [
      ["insuffisance renale chronique", 0.6, "nephrologie"],
      ["insuffisance respiratoire chronique", 0.4, "pneumologie"],
    ],
  ],
  ["FA", [["fibrillation auriculaire", 1.0, "cardiologie"]]],
  [
    "EP",
    [
      ["embolie pulmonaire", 0.7, "cardiologie/pneumologie"],
      ["epilepsie", 0.3, "neurologie"],
    ],
  ],
  ["SCA", [["syndrome coronarien aigu", 1.0, "cardiologie"]]],
  ["OAP", [["oedeme aigu du poumon", 1.0, "cardiologie/pneumologie"]]],
  ["MTEV", [["maladie thromboembolique veineuse", 1.0, "hematologie/vasculaire"]]],
];

export const ABBREVIATIONS: Map<string, AbbreviationEntry> = new Map(
  RAW_TABLE.map(([abbr, candidates]) => [
    abbr,
    {
      abbreviation: abbr,
      candidates: candidates.map(([expansion, weight, domain]) => ({
        expansion,
        weight,
        domain,
      })),
      ambiguous: candidates.length > 1,
    },
  ])
);

export function lookupAbbreviation(token: string): AbbreviationEntry | undefined {
  return ABBREVIATIONS.get(token.toUpperCase());
}
