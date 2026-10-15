export type Category = "correctness" | "clarity" | "concision" | "formality" | "citations";

export const CATEGORIES: { id: Category; label: string; description: string }[] = [
  { id: "correctness", label: "Correctness", description: "Typos, repeated words, mechanics" },
  { id: "clarity", label: "Clarity", description: "Sentences that are hard to follow" },
  { id: "concision", label: "Concision", description: "Wordy phrases and filler" },
  { id: "formality", label: "Formality", description: "Register suited to academic prose" },
  { id: "citations", label: "Citations", description: "In-text citation formatting" },
];

/** A finding within a single paragraph's plain text. Offsets are UTF-16 indices, end-exclusive. */
export interface RuleMatch {
  ruleId: string;
  category: Category;
  start: number;
  end: number;
  /** Short headline shown on the card, e.g. "Avoid contractions". */
  message: string;
  /** One or two sentences on why, written for a student. */
  explanation: string;
  /** Candidate replacements for text[start, end). Empty means "rephrase yourself". */
  replacements: string[];
}

export interface RuleContext {
  citationStyle?: "apa" | "mla" | "chicago" | "ieee";
}

export interface Rule {
  id: string;
  category: Category;
  check(text: string, ctx: RuleContext): RuleMatch[];
}
