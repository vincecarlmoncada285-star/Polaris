// Abbreviations that end in a period but do not end a sentence.
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "et al",
  "etc",
  "cf",
  "vs",
  "ed",
  "eds",
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "st",
  "approx",
  "ca",
  "resp",
]);
// These only abbreviate when a number follows ("Fig. 2", "p. 14"); otherwise "no." is a word.
const NUMBERING_ABBREVIATIONS = new Set([
  "fig",
  "figs",
  "eq",
  "eqs",
  "no",
  "vol",
  "pp",
  "p",
  "ch",
  "sec",
]);

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

/** Splits a paragraph into sentences, keeping offsets. Conservative: prefers under-splitting. */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  // The whole run of terminal punctuation and closers in one match, then the "followed by
  // whitespace or the end" test by hand: as a lookahead after a greedy run, a long run of
  // "." not followed by a space backtracked from every starting point (O(n²) on "....").
  const re = /[.!?]+["'”’)\]]*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    // A closing quote or bracket after the period means the sentence really ends.
    if (m[0] === "." && isAbbreviation(text, m.index)) continue;
    // A decimal like "3.5" never matches because of the lookahead requiring whitespace.
    pushTrimmed(sentences, text, start, end);
    start = end;
  }
  pushTrimmed(sentences, text, start, text.length);
  return sentences;
}

function isAbbreviation(text: string, dotIndex: number): boolean {
  const before = text.slice(Math.max(0, dotIndex - 8), dotIndex).toLowerCase();
  const word = before.match(/(?:et al|[a-z]+(?:\.[a-z]+)*)$/)?.[0];
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  if (NUMBERING_ABBREVIATIONS.has(word)) return /^\s+\d/.test(text.slice(dotIndex + 1));
  // Single capital initial ("J. Smith").
  return /(?:^|\s)[a-z]$/.test(before) && /[A-Z]/.test(text[dotIndex - 1] ?? "");
}

function pushTrimmed(out: Sentence[], text: string, start: number, end: number) {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end > start) out.push({ start, end, text: text.slice(start, end) });
}
