/**
 * When a suggestion deletes text (empty replacement), widen the range to swallow one
 * neighbouring space so "a very large" becomes "a large", not "a  large".
 */
export function expandDeletion(text: string, start: number, end: number): [number, number] {
  if (/\s/.test(text[end] ?? "") && (start === 0 || /\s/.test(text[start - 1] ?? ""))) {
    return [start, end + 1];
  }
  if (/\s/.test(text[start - 1] ?? "")) return [start - 1, end];
  return [start, end];
}
