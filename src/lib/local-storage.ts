// Per-browser preferences (the remembered tab, the library's search and sort, a dismissed help
// card). Storage can be blocked or full (private mode, a strict browser setting): then nothing
// is remembered and nothing breaks.

/** The stored value, or null when there is none or storage cannot be read. */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value` (or removes the key for null), if storage allows it. */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, that is all.
  }
}
