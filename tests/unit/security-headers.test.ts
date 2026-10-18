import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  HSTS_VALUE,
  contentSecurityPolicy,
  createNonce,
  securityHeaders,
} from "@/lib/security/headers";

const directives = (csp: string) =>
  new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values] as const;
    }),
  );

describe("createNonce", () => {
  it("is 128 random bits in base64, different every time", () => {
    const nonces = new Set(Array.from({ length: 200 }, createNonce));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("contentSecurityPolicy", () => {
  const nonce = createNonce();

  it("has exactly the production policy, with this response's nonce", () => {
    expect(contentSecurityPolicy({ nonce })).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("never lets inline or eval'd script run in production", () => {
    const script = directives(contentSecurityPolicy({ nonce })).get("script-src")!;
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("*");
    expect(contentSecurityPolicy({ nonce, dev: false })).toBe(contentSecurityPolicy({ nonce }));
  });

  it("adds only eval (React refresh) and ws: (the dev server) in development", () => {
    const prod = directives(contentSecurityPolicy({ nonce }));
    const dev = directives(contentSecurityPolicy({ nonce, dev: true }));
    expect(dev.get("script-src")).toEqual([...prod.get("script-src")!, "'unsafe-eval'"]);
    expect(dev.get("connect-src")).toEqual(["'self'", "ws:"]);
    expect(dev.get("script-src")).not.toContain("'unsafe-inline'");
    for (const [name, values] of prod) {
      if (name !== "script-src" && name !== "connect-src") expect(dev.get(name)).toEqual(values);
    }
  });

  it("refuses a nonce that could break out of its directive or the header", () => {
    for (const bad of [
      "",
      "short",
      "abc'; script-src *",
      "a b c d e f g h i j",
      "x\r\nSet-Cookie: a=b",
    ]) {
      expect(() => contentSecurityPolicy({ nonce: bad })).toThrow("Invalid CSP nonce");
    }
  });
});

describe("securityHeaders", () => {
  const asObject = (env: Record<string, string | undefined>) =>
    Object.fromEntries(securityHeaders(env).map((h) => [h.key, h.value]));

  it("sends the static headers on every response", () => {
    expect(asObject({})).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("adds Strict-Transport-Security only with POLARIS_HSTS=1", () => {
    expect(asObject({ POLARIS_HSTS: "1" })["Strict-Transport-Security"]).toBe(HSTS_VALUE);
    expect(asObject({ POLARIS_HSTS: " 1 " })["Strict-Transport-Security"]).toBe(HSTS_VALUE);
    for (const off of [undefined, "", "0", "true", "yes", "2"]) {
      expect(asObject({ POLARIS_HSTS: off })).not.toHaveProperty("Strict-Transport-Security");
    }
    expect(HSTS_VALUE).toMatch(/^max-age=\d{8,}/);
  });

  it("are what next.config.ts gives every path, and Next.js does not announce itself", async () => {
    const routes = await nextConfig.headers!();
    expect(routes).toEqual([{ source: "/:path*", headers: securityHeaders() }]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
