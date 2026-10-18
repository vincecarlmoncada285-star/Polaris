import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { users } from "@/lib/users";
import type { UserDTO } from "@/lib/users/service";
import { SESSION_EXPIRED_PATH, SIGN_IN_PATH } from "./routes";
import { sessionVersionMatches } from "./session-version";

export { SESSION_EXPIRED_PATH };

/**
 * The signed-in user, loaded fresh from the database (so a renamed user shows the new name
 * straight away), and the session version their session was checked against; or null. Null too
 * for a session that was revoked: one issued with an older session version than the user's (a
 * password change, or "Sign out of all other devices", since it was issued). Cached per
 * request: the layout and the page share one lookup.
 */
const getCurrentSession = cache(
  async (): Promise<{ user: UserDTO; sessionVersion: number } | null> => {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return null;
    const found = await users.getSessionUser(id);
    if (!found || !sessionVersionMatches(session.sessionVersion, found.sessionVersion)) {
      return null;
    }
    return found;
  },
);

/** The signed-in user (see getCurrentSession), or null. */
export const getCurrentUser = cache(
  async (): Promise<UserDTO | null> => (await getCurrentSession())?.user ?? null,
);

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/**
 * For API route handlers: the signed-in user's id, or a 401 response to return as is.
 *
 *   const userId = await requireUser();
 *   if (userId instanceof NextResponse) return userId;
 *
 * Checks the database too, so a session that outlived its account, or was revoked, is rejected.
 */
export async function requireUser(): Promise<string | NextResponse> {
  const user = await getCurrentUser();
  return user ? user.id : unauthorized();
}

/**
 * requireUser() for a route that raises the session version: also the version this session
 * carries, which the raise must still find in the database (a compare-and-swap). Otherwise a
 * session revoked between this check and the write could re-issue itself at the newest version
 * and sign out the device that revoked it.
 */
export async function requireUserSession(): Promise<
  { userId: string; sessionVersion: number } | NextResponse
> {
  const current = await getCurrentSession();
  return current
    ? { userId: current.user.id, sessionVersion: current.sessionVersion }
    : unauthorized();
}

/**
 * For server components of protected pages. Middleware has already redirected signed-out
 * visitors; this covers a valid session whose account no longer exists (deleted elsewhere, or
 * a reset dev database) or that was revoked, which middleware cannot see without the database:
 * /session/expired clears its cookie and sends it to sign in.
 */
export async function requirePageUser(callbackPath: string): Promise<UserDTO> {
  const user = await getCurrentUser();
  if (user) return user;
  if (await auth()) redirect(SESSION_EXPIRED_PATH);
  redirect(`${SIGN_IN_PATH}?${new URLSearchParams({ callbackUrl: callbackPath })}`);
}
