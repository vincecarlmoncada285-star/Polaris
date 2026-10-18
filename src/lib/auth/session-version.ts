import { AsyncLocalStorage } from "node:async_hooks";
import type { JWT } from "next-auth/jwt";

// Session revocation. Sessions are JWTs (no session table), so a JWT cannot be deleted; instead
// each one carries the user's `sessionVersion` from when it was issued, and the session helpers
// (./session.ts) treat one whose version differs from the database as signed out. Raising the
// version signs out every device at once; the device that asked is then re-issued a JWT with
// the new version (reissueSession below), so it stays signed in. Node only: src/auth.ts and
// the API routes use this, middleware does not.

/**
 * Whether a session JWT's version is the user's current one. A JWT from before versions
 * existed has none: it counts as version 0, the column's default, so upgrading Polaris does not
 * sign everyone out, while any later revocation does.
 */
export function sessionVersionMatches(tokenVersion: unknown, current: number): boolean {
  const version = typeof tokenVersion === "number" ? tokenVersion : 0;
  return version === current;
}

interface Reissue {
  userId: string;
  version: number;
}

// The re-issue this request is allowed to make. Only reissueSession() sets it, around its own
// call to Auth.js, so it exists only inside a server request that has just raised the version.
const reissueScope = new AsyncLocalStorage<Reissue>();

/**
 * For the jwt callback on `trigger: "update"`: the token, moved to the version that
 * reissueSession() is re-issuing it with, or unchanged. Auth.js also runs this trigger for
 * POST /api/auth/session, which any browser can send with any data, so the data is never read:
 * a device that was signed out cannot sign itself back in by asking for an update.
 */
export function applyReissue(token: JWT): JWT {
  const reissue = reissueScope.getStore();
  if (!reissue || typeof token.id !== "string" || token.id !== reissue.userId) return token;
  return { ...token, sessionVersion: reissue.version };
}

/**
 * Re-issues the current request's session JWT with `version`, through Auth.js's own update
 * (`unstable_update` from src/auth.ts, passed in so this module does not import it), which sets
 * the new cookie on the response. True when the session now carries that version.
 */
export async function reissueSession(
  userId: string,
  version: number,
  update: (data: Record<string, never>) => Promise<{ sessionVersion?: number } | null>,
): Promise<boolean> {
  const session = await reissueScope.run({ userId, version }, () => update({}));
  return session?.sessionVersion === version;
}
