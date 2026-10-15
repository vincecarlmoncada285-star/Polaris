import { useState } from "react";

/**
 * A key that changes every time `value` changes identity. Keying a role="alert" element with
 * it remounts the alert, so screen readers announce a repeated error (the same wrong password
 * twice) instead of staying silent because the text did not change.
 */
export function useAnnouncementKey(value: unknown): number {
  const [seen, setSeen] = useState(value);
  const [key, setKey] = useState(0);
  if (value !== seen) {
    setSeen(value);
    setKey(key + 1);
  }
  return key;
}
