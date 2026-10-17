// Which link targets Polaris accepts: http, https and mailto, nothing else. Pure functions, used
// by the editor's Link extension, the link dialog, the importer's sanitizer and the exporters.

export const LINK_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

/**
 * The href as a browser reads its scheme (the WHATWG URL parser): leading and trailing C0
 * controls and spaces are stripped, and tabs and newlines are removed anywhere. So
 * " javascript:" and "java\tscript:" are javascript: URLs and must be judged as such.
 */
function asBrowserReadsIt(raw: string): string {
  return raw.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "").replace(/[\t\n\r]/g, "");
}

/**
 * Whether `raw` is an absolute http, https or mailto URL. Everything else is refused: other
 * schemes (javascript:, data:, vbscript:, file:), relative and protocol-relative ("//evil.com")
 * URLs, and anything the URL parser rejects. Case does not matter ("JaVaScRiPt:" is refused).
 */
export function isAllowedLinkHref(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const href = asBrowserReadsIt(raw);
  // A scheme must come first: this refuses "//evil.com", "/path", "#anchor" and "".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return (LINK_PROTOCOLS as readonly string[]).includes(url.protocol);
}

// "www.example.com/page", "example.org:8080": a host name with a top-level domain, no scheme.
const BARE_HOST =
  /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/u;
const BARE_EMAIL = /^[^\s@/:<>()[\]\\,;"]+@(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}$/u;

/**
 * For the editor's Link extension (its isAllowedUri option). Autolinking checks the text it
 * found, which has no scheme yet ("www.example.com" or "ana@example.com"); the link it then
 * makes gets linkify's href with the scheme added. So a bare web or email address passes here
 * too; anything with a scheme must be http, https or mailto.
 */
export function isAllowedLinkUri(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  if (isAllowedLinkHref(raw)) return true;
  const text = raw.trim();
  return BARE_HOST.test(text) || BARE_EMAIL.test(text);
}

/**
 * What the writer typed into the link dialog, as an href: "" for no link, an allowed URL as
 * is, a bare web address with https:// and a bare email address with mailto: in front.
 * Null when it is none of these.
 */
export function normalizeLinkInput(input: string): string | null {
  const text = input.trim();
  if (text === "") return "";
  if (isAllowedLinkHref(text)) return asBrowserReadsIt(text);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:]+:\d/.test(text)) return null;
  if (BARE_EMAIL.test(text)) return `mailto:${text}`;
  if (BARE_HOST.test(text)) return `https://${text}`;
  return null;
}

/** The href to export for a stored link, or null to export its text without a link. */
export function exportableHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const normalized = normalizeLinkInput(href);
  return normalized ? normalized : null;
}
