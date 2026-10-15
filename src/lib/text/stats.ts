/** Counts words the way most word processors do: runs of letters/digits, allowing internal ' and -. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

export function countCharacters(text: string): number {
  return [...text].length;
}

/** Average adult silent reading speed for academic prose is roughly 200 wpm. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / 200));
}
