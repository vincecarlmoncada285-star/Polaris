import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";
import type { AiSuggestion } from "./protocol";
import type { SuggestionDraft } from "./schema";
import { NEUTRAL_LBRACKET, NEUTRAL_LT } from "./untrusted";

/**
 * Text with typographic variants folded together, plus a map from each normalized character
 * back to the span of the original it came from.
 */
interface Normalized {
  text: string;
  /** srcStart[i]: original index where normalized character i begins. */
  srcStart: number[];
  /** srcEnd[i]: original index (exclusive) where it ends. */
  srcEnd: number[];
}

const SINGLE_QUOTES = new Set(["‘", "’", "‚", "‛", "′", "ʼ"]);
const DOUBLE_QUOTES = new Set(["“", "”", "„", "‟", "″"]);
const DASHES = new Set(["-", "‐", "‑", "‒", "–", "—", "―", "−"]);

// Inline atoms (hard breaks) are sent to Claude as line breaks, so they match whitespace.
const isSpace = (c: string) => /\s/.test(c) || c === OBJECT_REPLACEMENT;

/**
 * Folds curly and straight quotes, every dash (and runs of them, so "--" matches "—"),
 * whitespace runs, "…" vs "...", and the "＜" and "［" that neutralize tag-like text and
 * marker-like text in the prompts (src/lib/ai/untrusted.ts), so a quote of either is found.
 */
function normalize(s: string): Normalized {
  let text = "";
  const srcStart: number[] = [];
  const srcEnd: number[] = [];
  const push = (ch: string, from: number, to: number) => {
    text += ch;
    srcStart.push(from);
    srcEnd.push(to);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    const run = (test: (c: string) => boolean) => {
      let j = i + 1;
      while (j < s.length && test(s[j]!)) j++;
      return j;
    };
    if (isSpace(c)) {
      const j = run(isSpace);
      push(" ", i, j);
      i = j;
    } else if (DASHES.has(c)) {
      const j = run((d) => DASHES.has(d));
      push("-", i, j);
      i = j;
    } else {
      if (c === "…") for (let k = 0; k < 3; k++) push(".", i, i + 1);
      else if (SINGLE_QUOTES.has(c)) push("'", i, i + 1);
      else if (DOUBLE_QUOTES.has(c)) push('"', i, i + 1);
      else if (c === NEUTRAL_LT) push("<", i, i + 1);
      else if (c === NEUTRAL_LBRACKET) push("[", i, i + 1);
      else push(c, i, i + 1);
      i++;
    }
  }
  return { text, srcStart, srcEnd };
}

/** Start indices of every non-overlapping occurrence of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    found.push(i);
  }
  return found;
}

/**
 * Picks the `occurrence`-th (1-based) match, or the first when none is given. A quote that
 * appears only once is unambiguous, so a wrong occurrence number there is ignored; with
 * several matches an out-of-range number means we cannot tell which one Claude meant.
 */
function pick(found: number[], occurrence: number | null): number | null {
  if (found.length === 0) return null;
  if (found.length === 1) return found[0]!;
  const n = occurrence ?? 1;
  return n <= found.length ? found[n - 1]! : null;
}

/**
 * Where `quote` sits in `text`, as [start, end) offsets: an exact match first, then a match
 * that tolerates curly vs straight quotes, dash variants and whitespace differences, mapped
 * back to the original offsets. Null if it cannot be found.
 */
export function findQuote(
  text: string,
  quote: string,
  occurrence: number | null = null,
): [number, number] | null {
  return createQuoteFinder(text)(quote, occurrence);
}

export type QuoteFinder = (quote: string, occurrence?: number | null) => [number, number] | null;

/**
 * findQuote for many quotes in one text: the text is normalized at most once, on the first
 * quote that has no exact match (normalizing a review-sized document takes ~100 ms).
 */
export function createQuoteFinder(text: string): QuoteFinder {
  let t: Normalized | null = null;
  return (quote, occurrence = null) => {
    if (!quote) return null;
    const exact = pick(occurrences(text, quote), occurrence);
    if (exact !== null) return [exact, exact + quote.length];

    t ??= normalize(text);
    const q = normalize(quote).text.trim();
    const at = pick(occurrences(t.text, q), occurrence);
    if (at === null) return null;
    const start = t.srcStart[at]!;
    const end = t.srcEnd[at + q.length - 1]!;
    return end > start ? [start, end] : null;
  };
}

/**
 * Anchors cleaned suggestions to `text`. Drops those whose quote cannot be found, whose
 * replacement would change nothing, or that overlap a suggestion kept before them (Claude
 * lists the most important first). The result is sorted by position.
 */
export function anchorSuggestions(text: string, drafts: SuggestionDraft[]): AiSuggestion[] {
  const kept: AiSuggestion[] = [];
  for (const d of drafts) {
    const range = findQuote(text, d.quote, d.occurrence);
    if (!range) continue;
    const [start, end] = range;
    if (
      d.replacement !== null &&
      (d.replacement === d.quote || d.replacement === text.slice(start, end))
    ) {
      continue;
    }
    if (kept.some((k) => start < k.end && k.start < end)) continue;
    kept.push({
      start,
      end,
      category: d.category,
      message: d.message,
      explanation: d.explanation,
      replacements: d.replacement === null ? [] : [d.replacement],
    });
  }
  return kept.sort((a, b) => a.start - b.start);
}
