// Alt+] and Alt+[: moving from one suggestion to the next in the text, in reading order.

export interface Placed {
  key: string;
  from: number;
  to: number;
}

const inReadingOrder = (a: Placed, b: Placed) => a.from - b.from || a.to - b.to;

/** The suggestions in the order they appear in the text. */
export const readingOrder = <T extends Placed>(suggestions: readonly T[]): T[] =>
  [...suggestions].sort(inReadingOrder);

/**
 * The suggestion after (direction 1) or before (-1) the open one, wrapping around at the ends.
 * With none open, the first one that starts at or after the selection's end (or the last one
 * that starts before its start, going back): so after Escape, which leaves the flagged text
 * selected, Alt+] moves on to the next one rather than reopening it. Null when there are none.
 */
export function adjacentSuggestion<T extends Placed>(
  suggestions: readonly T[],
  { activeKey, from, to }: { activeKey: string | null; from: number; to: number },
  direction: 1 | -1,
): T | null {
  if (suggestions.length === 0) return null;
  const ordered = readingOrder(suggestions);
  const last = ordered.length - 1;
  const open = activeKey === null ? -1 : ordered.findIndex((s) => s.key === activeKey);
  if (open >= 0) {
    return ordered[(open + direction + ordered.length) % ordered.length]!;
  }
  if (direction === 1) return ordered.find((s) => s.from >= to) ?? ordered[0]!;
  return ordered.findLast((s) => s.from < from) ?? ordered[last]!;
}
