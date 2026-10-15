import { BUILTIN_RULES } from "./builtin";
import type { Rule, RuleContext, RuleMatch } from "./types";

/**
 * Runs every rule over one paragraph. Results are sorted by position, and a match that
 * overlaps an earlier, higher-priority match (earlier in `rules`) is dropped so two
 * underlines never fight over the same characters. Long-sentence matches are exempt:
 * they span whole sentences and are drawn differently.
 */
export function checkParagraph(
  text: string,
  ctx: RuleContext = {},
  rules: Rule[] = BUILTIN_RULES,
): RuleMatch[] {
  const accepted: RuleMatch[] = [];
  const spans: RuleMatch[] = [];
  for (const rule of rules) {
    for (const match of rule.check(text, ctx)) {
      if (match.end <= match.start) continue;
      if (match.ruleId === "long-sentence") {
        spans.push(match);
        continue;
      }
      if (accepted.some((a) => match.start < a.end && a.start < match.end)) continue;
      accepted.push(match);
    }
  }
  return [...accepted, ...spans].sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Small LRU so re-checking an unchanged paragraph on every keystroke costs a map lookup. */
export function createParagraphChecker(getContext: () => RuleContext = () => ({}), capacity = 500) {
  const cache = new Map<string, RuleMatch[]>();
  return (text: string): RuleMatch[] => {
    const ctx = getContext();
    const key = `${ctx.citationStyle ?? ""}\u0000${text}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const result = checkParagraph(text, ctx);
    cache.set(key, result);
    if (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return result;
  };
}
