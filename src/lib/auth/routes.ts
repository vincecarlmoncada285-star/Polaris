// Edge-safe: imported by middleware through auth.config.ts, so no Node or Prisma imports.

export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";

/**
 * Where sign-up sends a new account whose automatic sign-in was refused (e.g. rate limited),
 * so the sign-in page can say that the account does exist.
 */
export const ACCOUNT_CREATED_PARAM = "created";
export const ACCOUNT_CREATED_PATH = `${SIGN_IN_PATH}?${ACCOUNT_CREATED_PARAM}=1`;

const AUTH_PAGES = new Set([SIGN_IN_PATH, SIGN_UP_PATH]);

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Pages that need a signed-in user. API routes check for themselves (requireUser). */
export function isProtectedPath(pathname: string): boolean {
  return pathname === "/" || isUnder(pathname, "/documents") || isUnder(pathname, "/settings");
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.has(pathname);
}

export type RouteDecision = { kind: "allow" } | { kind: "redirect"; to: string };

/**
 * What middleware does with a page request: send signed-out visitors of protected pages to
 * sign in (remembering where they were going), and signed-in visitors of the sign-in and
 * sign-up pages home.
 */
export function routeDecision(pathname: string, search: string, signedIn: boolean): RouteDecision {
  if (isAuthPage(pathname)) return signedIn ? { kind: "redirect", to: "/" } : { kind: "allow" };
  if (!signedIn && isProtectedPath(pathname)) {
    const params = new URLSearchParams({ callbackUrl: `${pathname}${search}` });
    return { kind: "redirect", to: `${SIGN_IN_PATH}?${params}` };
  }
  return { kind: "allow" };
}
