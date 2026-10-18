// Security headers. Edge-safe and free of path aliases: middleware imports the CSP builder for
// every page, and next.config.ts imports the static headers (by relative path) when it builds.

/** A fresh nonce for one response's Content-Security-Policy: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

const NONCE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;

/**
 * The Content-Security-Policy for a page. Scripts run only from Polaris itself with this
 * response's nonce, which Next.js puts on its own scripts; 'strict-dynamic' lets those load
 * the chunks they import (the editor, the import and export converters). Styles may be inline:
 * React's style attributes and TipTap's injected stylesheet need it, and styles cannot run code.
 * In development, React's fast refresh needs eval and the dev server's WebSocket, and nothing
 * else is added.
 */
export function contentSecurityPolicy({ nonce, dev = false }: { nonce: string; dev?: boolean }) {
  // A nonce goes into a header: refuse anything that could end the directive or the header.
  if (!NONCE.test(nonce)) throw new Error("Invalid CSP nonce");
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(dev ? ["ws:"] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export interface Header {
  key: string;
  value: string;
}

/** One year, the minimum the HSTS preload list asks for (Polaris does not ask to be preloaded). */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Headers for every response: pages, API routes and static files (next.config.ts headers()).
 * Strict-Transport-Security only with POLARIS_HSTS=1: it tells browsers to refuse plain HTTP
 * to this host for a year, so it is only safe once Polaris is served over HTTPS (behind a
 * reverse proxy, say); on a plain-HTTP install it would lock everyone out. Next.js writes these
 * headers into the build, so POLARIS_HSTS is read when the app is built.
 */
export function securityHeaders(env: Record<string, string | undefined> = process.env): Header[] {
  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (env.POLARIS_HSTS?.trim() === "1") {
    headers.push({ key: "Strict-Transport-Security", value: HSTS_VALUE });
  }
  return headers;
}
