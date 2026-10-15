const PLACEHOLDER_ORIGIN = "http://polaris.invalid";

/** Protocol-relative (`//host`), or a backslash, which browsers read as a slash. */
const OFF_SITE_PREFIX = /^\/[/\\]/;

/**
 * Returns `raw` if it is a same-origin relative path (like `/documents/abc?x=1`), else
 * `fallback`. Used for `callbackUrl`, which arrives from the query string and so is
 * attacker-controlled: an open redirect after sign-in is a classic phishing aid.
 */
export function sanitizeCallbackUrl(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  // One leading slash only: `//evil.com` is protocol-relative, and browsers treat `\` like `/`.
  if (!raw.startsWith("/") || OFF_SITE_PREFIX.test(raw)) return fallback;
  // Backslashes and control characters: browsers turn `/\evil.com` into `//evil.com`, and
  // strip tabs and newlines, so `/\t/evil.com` would become `//evil.com` too.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  // Belt and braces: resolving it must not leave our origin.
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  // Check what we return, not just what came in: resolving dot segments can turn a harmless
  // looking `/..//evil.com` or `/%2e//evil.com` into the protocol-relative `//evil.com`.
  const result = `${url.pathname}${url.search}${url.hash}`;
  return OFF_SITE_PREFIX.test(result) || result.includes("\\") ? fallback : result;
}
