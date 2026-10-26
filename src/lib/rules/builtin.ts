import { matchCase } from "./case";
import { splitSentences } from "./sentences";
import type { Rule, RuleMatch } from "./types";

/** Builds a rule from a phrase → replacements table, matched on word boundaries, case-insensitively. */
function phraseRule(
  id: string,
  category: Rule["category"],
  table: Record<string, string[]>,
  describe: (phrase: string) => { message: string; explanation: string },
): Rule {
  const phrases = Object.keys(table).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}'’])(?:${phrases.map(escapeForPattern).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return {
    id,
    category,
    check(text) {
      const out: RuleMatch[] = [];
      for (const m of text.matchAll(pattern)) {
        const key = m[0].toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
        const replacements = (table[key] ?? []).map((r) => matchCase(m[0], r));
        out.push({
          ruleId: id,
          category,
          start: m.index,
          end: m.index + m[0].length,
          replacements,
          ...describe(key),
        });
      }
      return out;
    },
  };
}

function escapeForPattern(phrase: string): string {
  return phrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "['’]")
    .replace(/ /g, "\\s+");
}

export const contractions = phraseRule(
  "contractions",
  "formality",
  {
    "aren't": ["are not"],
    "can't": ["cannot"],
    "couldn't": ["could not"],
    "didn't": ["did not"],
    "doesn't": ["does not"],
    "don't": ["do not"],
    "hadn't": ["had not"],
    "hasn't": ["has not"],
    "haven't": ["have not"],
    "isn't": ["is not"],
    "it's": ["it is"],
    "let's": ["let us"],
    "mightn't": ["might not"],
    "mustn't": ["must not"],
    "shouldn't": ["should not"],
    "that's": ["that is"],
    "there's": ["there is"],
    "they're": ["they are"],
    "wasn't": ["was not"],
    "we're": ["we are"],
    "weren't": ["were not"],
    "what's": ["what is"],
    "won't": ["will not"],
    "wouldn't": ["would not"],
    "you're": ["you are"],
    "i'm": ["I am"],
    "they've": ["they have"],
    "we've": ["we have"],
    "i've": ["I have"],
    "they'll": ["they will"],
    "we'll": ["we will"],
    "it'll": ["it will"],
    "who's": ["who is"],
    "here's": ["here is"],
  },
  () => ({
    message: "Avoid contractions",
    explanation:
      "Contractions read as conversational. Most academic style guides prefer the full form.",
  }),
);

export const vagueIntensifiers = phraseRule(
  "vague-intensifiers",
  "concision",
  {
    very: [""],
    really: [""],
    extremely: [""],
    quite: [""],
    incredibly: [""],
    totally: [""],
    "a lot of": ["many", "much"],
    "lots of": ["many", "much"],
    hugely: [""],
    super: [""],
  },
  (phrase) => ({
    message: `“${phrase}” adds little`,
    explanation:
      "Intensifiers weaken academic claims. Use a precise word or quantify instead (e.g. “significantly, p < .05”).",
  }),
);

export const wordyPhrases = phraseRule(
  "wordy-phrases",
  "concision",
  {
    "in order to": ["to"],
    "due to the fact that": ["because"],
    "owing to the fact that": ["because"],
    "in spite of the fact that": ["although"],
    "despite the fact that": ["although"],
    "at this point in time": ["now", "currently"],
    "at the present time": ["currently"],
    "for the purpose of": ["to", "for"],
    "in the event that": ["if"],
    "with regard to": ["about", "regarding"],
    "with respect to": ["about", "regarding"],
    "it is important to note that": [""],
    "it should be noted that": [""],
    "the fact that": ["that"],
    "is able to": ["can"],
    "are able to": ["can"],
    "has the ability to": ["can"],
    "a large number of": ["many"],
    "a majority of": ["most"],
    "in close proximity to": ["near"],
    "prior to": ["before"],
    "subsequent to": ["after"],
    "in the process of": [""],
    "on a daily basis": ["daily"],
    "each and every": ["every"],
    "first and foremost": ["first"],
    "basic fundamentals": ["fundamentals"],
    "past history": ["history"],
    "end result": ["result"],
    "future plans": ["plans"],
  },
  () => ({
    message: "Wordy phrase",
    explanation: "A shorter phrasing says the same thing and keeps the reader on your argument.",
  }),
);

export const informalWords = phraseRule(
  "informal-words",
  "formality",
  {
    stuff: ["material", "content"],
    things: ["factors", "aspects", "elements"],
    thing: ["factor", "aspect"],
    "kind of": ["somewhat", "rather"],
    "sort of": ["somewhat", "rather"],
    "pretty much": ["largely", "almost"],
    "a bit": ["slightly", "somewhat"],
    huge: ["substantial", "considerable"],
    big: ["large", "major"],
    "get rid of": ["eliminate", "remove"],
    "figure out": ["determine", "establish"],
    "find out": ["discover", "determine"],
    "look into": ["investigate", "examine"],
    "come up with": ["develop", "propose"],
    okay: ["acceptable"],
    ok: ["acceptable"],
    gonna: ["going to"],
    wanna: ["want to"],
    nowadays: ["currently", "today"],
  },
  () => ({
    message: "Informal word choice",
    explanation: "This phrasing is common in speech but reads as casual in academic writing.",
  }),
);

const BE = "(?:am|is|are|was|were|be|been|being)";
const IRREGULAR_PARTICIPLES =
  "(?:begun|broken|brought|built|bought|caught|chosen|done|drawn|driven|eaten|fallen|felt|found|forgotten|given|gone|grown|held|hidden|kept|known|laid|led|left|lost|made|meant|met|paid|put|read|run|said|seen|sent|set|shown|shut|sold|spoken|spent|stolen|taken|taught|thought|told|understood|won|worn|written)";
// Common -ed adjectives that follow "be" but are not passive ("is interested", "was tired").
const ED_ADJECTIVES = new Set([
  "interested",
  "tired",
  "bored",
  "excited",
  "worried",
  "concerned",
  "pleased",
  "satisfied",
  "surprised",
  "confused",
  "married",
  "related",
  "involved",
  "supposed",
  "used",
  "required",
  "based",
  "limited",
  "detailed",
  "complicated",
  "advanced",
  "experienced",
  "qualified",
]);

export const passiveVoice: Rule = {
  id: "passive-voice",
  category: "clarity",
  check(text) {
    const re = new RegExp(
      `\\b${BE}\\s+(?:\\w+ly\\s+)?(\\w+ed|${IRREGULAR_PARTICIPLES})\\b(\\s+by\\b)?`,
      "gi",
    );
    const out: RuleMatch[] = [];
    for (const m of text.matchAll(re)) {
      const participle = m[1]!.toLowerCase();
      if (ED_ADJECTIVES.has(participle) && !m[2]) continue;
      out.push({
        ruleId: "passive-voice",
        category: "clarity",
        start: m.index,
        end: m.index + m[0].length - (m[2]?.length ?? 0),
        message: "Passive voice",
        explanation:
          "Passive voice can hide who did what. It is often fine in methods sections; elsewhere, consider naming the actor.",
        replacements: [],
      });
    }
    return out;
  },
};

const LONG_SENTENCE_WORDS = 40;

export const longSentences: Rule = {
  id: "long-sentence",
  category: "clarity",
  check(text) {
    return splitSentences(text)
      .filter((s) => s.text.split(/\s+/).filter(Boolean).length > LONG_SENTENCE_WORDS)
      .map((s) => ({
        ruleId: "long-sentence",
        category: "clarity" as const,
        start: s.start,
        end: s.end,
        message: "Long sentence",
        explanation: `This sentence has more than ${LONG_SENTENCE_WORDS} words. Splitting it may make your argument easier to follow.`,
        replacements: [],
      }));
  },
};

/**
 * A word, whitespace, the same word. The edges are Unicode-aware (\b is not, so it missed
 * "très très"), and a word joined to the next by a hyphen or apostrophe is part of a longer
 * one, so "in in-person" and "a check-in in May" are not doubled words.
 */
const DOUBLED_WORD = /(?<![\p{L}\p{M}\p{N}'’-])([\p{L}\p{M}]+)(\s+)\1(?![\p{L}\p{M}\p{N}'’-])/giu;

export const repeatedWords: Rule = {
  id: "repeated-word",
  category: "correctness",
  check(text) {
    const out: RuleMatch[] = [];
    // "had had" and "that that" can be grammatical, so leave them alone.
    for (const m of text.matchAll(DOUBLED_WORD)) {
      const word = m[1]!.toLowerCase();
      if (word === "had" || word === "that") continue;
      out.push({
        ruleId: "repeated-word",
        category: "correctness",
        start: m.index,
        end: m.index + m[0].length,
        message: `Repeated word “${m[1]}”`,
        explanation: "The same word appears twice in a row.",
        replacements: [m[1]!],
      });
    }
    return out;
  },
};

export const citationFormat: Rule = {
  id: "citation-format",
  category: "citations",
  check(text, ctx) {
    const out: RuleMatch[] = [];
    const push = (start: number, end: number, message: string, explanation: string, fix: string) =>
      out.push({
        ruleId: "citation-format",
        category: "citations",
        start,
        end,
        message,
        explanation,
        replacements: [fix],
      });

    // "et al" without a period, wherever it appears.
    for (const m of text.matchAll(/\bet al\b(?!\.)/g)) {
      push(
        m.index,
        m.index + m[0].length,
        "Add a period to “et al.”",
        "“al.” abbreviates the Latin “alii”, so it takes a period.",
        "et al.",
      );
    }

    // APA wants a comma between author and year: (Smith 2020) → (Smith, 2020).
    if (!ctx.citationStyle || ctx.citationStyle === "apa") {
      const author = "[A-Z][\\p{L}'’\\-]+(?:\\s+(?:&|and)\\s+[A-Z][\\p{L}'’\\-]+|\\s+et al\\.?)?";
      const re = new RegExp(`\\((${author})\\s+((?:19|20)\\d{2}[a-z]?)\\)`, "gu");
      for (const m of text.matchAll(re)) {
        push(
          m.index,
          m.index + m[0].length,
          "APA: comma between author and year",
          "APA in-text citations separate the author and year with a comma.",
          `(${m[1]}, ${m[2]})`,
        );
      }
      // Inside parentheses APA uses "&", not "and": (Smith and Lee, 2020) → (Smith & Lee, 2020).
      const andRe = /\(([A-Z][\p{L}'’-]+) and ([A-Z][\p{L}'’-]+),\s*((?:19|20)\d{2}[a-z]?)\)/gu;
      for (const m of text.matchAll(andRe)) {
        push(
          m.index,
          m.index + m[0].length,
          "APA: use “&” inside parentheses",
          "In parenthetical APA citations, join two authors with an ampersand.",
          `(${m[1]} & ${m[2]}, ${m[3]})`,
        );
      }
    }

    // MLA uses author and page with no comma: (Smith, 42) → (Smith 42).
    if (ctx.citationStyle === "mla") {
      for (const m of text.matchAll(/\(([A-Z][\p{L}'’-]+),\s+(\d+(?:[–-]\d+)?)\)/gu)) {
        push(
          m.index,
          m.index + m[0].length,
          "MLA: no comma before page number",
          "MLA in-text citations put the author and page number side by side without a comma.",
          `(${m[1]} ${m[2]})`,
        );
      }
    }
    return out;
  },
};

export const BUILTIN_RULES: Rule[] = [
  repeatedWords,
  contractions,
  informalWords,
  wordyPhrases,
  vagueIntensifiers,
  passiveVoice,
  longSentences,
  citationFormat,
];
