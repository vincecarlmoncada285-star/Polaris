import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { contentSecurityPolicy, createNonce } from "@/lib/security/headers";

// Only the edge-safe config: the `authorized` callback decides redirects from the JWT alone.
const { auth } = NextAuth(authConfig);

/**
 * Runs for every page request once `authorized` has let it through (a redirect it returns
 * instead has no body to protect). Each response gets its own CSP nonce: Next.js reads it from
 * the request's Content-Security-Policy header and puts it on the scripts it renders, which is
 * why every page renders dynamically.
 */
export default auth((request) => {
  const nonce = createNonce();
  const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  // Every page, including ones whose path has a dot in it (a 404 for /notes.txt is a page
  // too). API routes authenticate themselves with requireUser() and send no HTML; Next's own
  // files under /_next and the icon never need a session. next.config.ts gives all of them the
  // static security headers.
  matcher: ["/((?!api/|_next/|icon\\.svg$).*)"],
};
