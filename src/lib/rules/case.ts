/** Applies the capitalization of `original` to `replacement` (first-letter or all-caps). */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(original)) return replacement[0]!.toUpperCase() + replacement.slice(1);
  return replacement;
}
