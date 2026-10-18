import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { users } from "@/lib/users";
import type { UserDTO } from "@/lib/users/service";
import { SIGN_IN_PATH } from "./routes";
import { sessionVersionMatches } from "./session-version";

export const SESSION_EXPIRED_PATH = "/session/expired";

/**
 * The signed-in user, loaded fresh from the database (so a renamed user shows the new name
 * straight away), or null. Null too for a session that was revoked: one issued with an older
 * session version than the user's (a password change, or "Sign out of all other devices", since
 * it was issued). Cached per request: the layout and the page share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<UserDTO | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const found = await users.getSessionUser(id);
  if (!found || !sessionVersionMatches(session.sessionVersion, found.sessionVersion)) return null;
  return found.user;
});

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
  return user ? user.id : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
