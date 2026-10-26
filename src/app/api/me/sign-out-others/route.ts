import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import { limits, RATE_LIMITED_MESSAGE } from "@/lib/auth/limits";
import { requireUserSession } from "@/lib/auth/session";
import { reissueSession } from "@/lib/auth/session-version";
import { crossSiteRefusal } from "@/lib/http/request";
import { users } from "@/lib/users";

/**
 * "Sign out of all other devices": raises the session version, so every session issued before
 * now is refused, and re-issues this device's session (a new cookie in the response) so it
 * stays signed in. 204 on success.
 */
export async function POST(req: Request) {
  const session = await requireUserSession();
  if (session instanceof NextResponse) return session;
  const refused = crossSiteRefusal(req);
  if (refused) return refused;
  const { userId } = session;
  if (!limits.revokeSessions.hit(userId).ok) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  // Only from the version this session carries: if it was revoked since the check above, it
  // is signed out like the rest.
  const version = await users.revokeSessions(userId, session.sessionVersion);
  if (version === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await reissueSession(userId, version, unstable_update))) {
    // Every session is signed out then, this one included: say so rather than claim success.
    console.error("Sign out of other devices: could not re-issue the current session");
    return NextResponse.json(
      { error: "You were signed out on this device too. Sign in again." },
      { status: 500 },
    );
  }
  return new NextResponse(null, { status: 204 });
}
