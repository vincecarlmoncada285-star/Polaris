// Writing metrics for the Overview panel. Pure functions over plain text: no editor, no DOM.
// Every number here is a rough, transparent measure, never a grade: the panel explains each one.
import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";
import { passiveVoice } from "@/lib/rules/builtin";
import { splitSentences } from "@/lib/rules/sentences";
import { readingMinutes } from "./stats";

/** One textblock of the document, in order. */
export interface MetricsBlock {
  text: string;
  /** Headings count towards the word count, but are not sentences: no readability, no openers. */
  heading?: boolean;
  /** Code blocks likewise: they count as words, but are not prose. */
  code?: boolean;
}

/** Where a sentence is: block index, then [start, end) offsets in that block's text. */
export interface SentenceLocation {
  block: number;
  start: number;
  end: number;
  words: number;
  text: string;
}

export interface WritingMetrics {
  /** Every word, headings included: the same count as the editor's footer. */
  words: number;
  /** Words in sentences (headings and code left out). The readability formulas use these. */
  proseWords: number;
  sentences: number;
  /** Non-empty blocks that are not headings or code. */
  paragraphs: number;
  syllables: number;
  /** Words per sentence; null with no sentences. */
  averageSentenceLength: number | null;
  /** Standard deviation of sentence length in words (population); null with no sentences. */
  sentenceLengthSpread: number | null;
  longestSentence: SentenceLocation | null;
  fleschReadingEase: number | null;
  fleschKincaidGrade: number | null;
  /** Share (0..1) of sentences with at least one passive construction; null with no sentences. */
  passiveShare: number | null;
  /** Type-token ratio: MATTR over a 50-word window, or plain TTR for shorter texts. */
  lexicalVariety: { value: number; method: "mattr" | "ttr" } | null;
  /** First words that open 3 or more sentences, most frequent first, at most 3. */
  repeatedOpeners: { word: string; count: number }[];
  readingMinutes: number;
}

export const MATTR_WINDOW = 50;
export const OPENER_MIN_COUNT = 3;
const MAX_OPENERS = 3;

// The same tokens as countWords() in stats.ts: letters and digits, with internal ' and -.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * Estimated syllables in one word. A heuristic, as every readability tool uses: count groups
 * of vowels (y included), then correct for the commonest English spellings that break that
 * rule:
 * - a silent final "e" (make, while), except "-le" after a consonant (table, little);
 * - a silent "-es" or "-ed" (makes, named), except after sibilants (places, boxes, wishes) and
 *   "-ted"/"-ded" (wanted, needed);
 * - a silent "e" before -ly, -ment, -ness, -ful, -less (completely, statement, useful);
 * - "ia", "io", "iu" said as two syllables (media, period), except after t, s or c, where they
 *   are one (nation, vision, special).
 * Words of three letters or fewer are one syllable. It gets most everyday and academic words
 * right and is off by one on some (created, science, area); over a whole document the errors
 * mostly cancel out. Tokens without Latin letters (numbers, other scripts) count as one.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return /[\p{L}\p{N}]/u.test(word) ? 1 : 0;
  if (w.length <= 3) return 1;
  let n = w.match(/[aeiouy]+/g)?.length ?? 0;
  if (/[^aeiouy]e$/.test(w)) {
    if (!/[^aeiouy]le$/.test(w)) n--;
  } else if (/[^aeiouy]es$/.test(w)) {
    if (!/(?:[cgsxz]|sh|ch)es$/.test(w)) n--;
  } else if (/[^aeiouy]ed$/.test(w)) {
    if (!/[td]ed$/.test(w)) n--;
  }
  if (/[^aeiouy]e(?:ly|ment|ness|ful|less)$/.test(w)) n--;
  n += w.match(/(?<![tsc])i[aou]/g)?.length ?? 0;
  return Math.max(1, n);
}

/** Flesch Reading Ease: 206.835 − 1.015 × words/sentence − 84.6 × syllables/word. */
export function fleschReadingEase(words: number, sentences: number, syllables: number): number {
  return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
}

/** Flesch–Kincaid Grade Level: 0.39 × words/sentence + 11.8 × syllables/word − 15.59. */
export function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

/**
 * Moving-average type-token ratio (Covington & McFall, 2010): the share of distinct words in
 * every run of `window` consecutive words, averaged. Unlike plain TTR it does not fall just
 * because a text is longer. Texts shorter than one window get plain TTR.
 */
export function lexicalVariety(
  tokens: readonly string[],
  window = MATTR_WINDOW,
): WritingMetrics["lexicalVariety"] {
  if (tokens.length === 0) return null;
  if (tokens.length < window) {
    return { value: new Set(tokens).size / tokens.length, method: "ttr" };
  }
  const counts = new Map<string, number>();
  const add = (t: string, d: number) => {
    const next = (counts.get(t) ?? 0) + d;
    if (next === 0) counts.delete(t);
    else counts.set(t, next);
  };
  for (let i = 0; i < window; i++) add(tokens[i]!, 1);
  let sum = counts.size;
  for (let i = window; i < tokens.length; i++) {
    add(tokens[i]!, 1);
    add(tokens[i - window]!, -1);
    sum += counts.size;
  }
  const windows = tokens.length - window + 1;
  return { value: sum / windows / window, method: "mattr" };
}

/** Plain text (paragraphs separated by blank lines) as blocks, for callers without an editor. */
export function textToBlocks(text: string): MetricsBlock[] {
  return text.split(/\n[ \t]*\n/).map((t) => ({ text: t }));
}

/** Words for type counting: case and apostrophe style do not make a new type. */
const typeOf = (word: string) => word.toLowerCase().replace(/’/g, "'");

export function computeMetrics(input: string | readonly MetricsBlock[]): WritingMetrics {
  const blocks = typeof input === "string" ? textToBlocks(input) : input;
  let words = 0;
  let paragraphs = 0;
  let syllables = 0;
  const lengths: number[] = [];
  const tokens: string[] = [];
  let longest: SentenceLocation | null = null;
  let passiveSentences = 0;
  const openers = new Map<string, { word: string; count: number; first: number }>();
  const syllableCache = new Map<string, number>();

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    // Inline atoms (hard breaks) separate words, like the line breaks they stand for.
    const text = block.text.replaceAll(OBJECT_REPLACEMENT, "\n");
    const blockWords = text.match(WORD)?.length ?? 0;
    words += blockWords;
    if (block.heading || block.code || blockWords === 0) continue;
    paragraphs++;
    const passiveStarts = passiveVoice.check(text, {}).map((m) => m.start);
    for (const s of splitSentences(text)) {
      const sentenceWords = s.text.match(WORD);
      if (!sentenceWords) continue;
      lengths.push(sentenceWords.length);
      for (const w of sentenceWords) {
        const type = typeOf(w);
        tokens.push(type);
        let n = syllableCache.get(type);
        if (n === undefined) syllableCache.set(type, (n = countSyllables(w)));
        syllables += n;
      }
      if (!longest || sentenceWords.length > longest.words) {
        longest = {
          block: index,
          start: s.start,
          end: s.end,
          words: sentenceWords.length,
          text: block.text.slice(s.start, s.end),
        };
      }
      if (passiveStarts.some((p) => p >= s.start && p < s.end)) passiveSentences++;
      const opener = typeOf(sentenceWords[0]!);
      const seen = openers.get(opener);
      if (seen) seen.count++;
      else openers.set(opener, { word: sentenceWords[0]!, count: 1, first: openers.size });
    }
  }

  const sentences = lengths.length;
  const proseWords = tokens.length;
  const average = sentences ? proseWords / sentences : null;
  const spread =
    average === null
      ? null
      : Math.sqrt(lengths.reduce((sum, l) => sum + (l - average) ** 2, 0) / sentences);

  return {
    words,
    proseWords,
    sentences,
    paragraphs,
    syllables,
    averageSentenceLength: average,
    sentenceLengthSpread: spread,
    longestSentence: longest,
    fleschReadingEase: sentences ? fleschReadingEase(proseWords, sentences, syllables) : null,
    fleschKincaidGrade: sentences ? fleschKincaidGrade(proseWords, sentences, syllables) : null,
    passiveShare: sentences ? passiveSentences / sentences : null,
    lexicalVariety: lexicalVariety(tokens),
    repeatedOpeners: [...openers.values()]
      .filter((o) => o.count >= OPENER_MIN_COUNT)
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, MAX_OPENERS)
      .map(({ word, count }) => ({ word, count })),
    readingMinutes: readingMinutes(words),
  };
}
