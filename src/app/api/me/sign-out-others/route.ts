import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import { limits, RATE_LIMITED_MESSAGE } from "@/lib/auth/limits";
import { requireUser } from "@/lib/auth/session";
import { reissueSession } from "@/lib/auth/session-version";
import { users } from "@/lib/users";

/**
 * "Sign out of all other devices": raises the session version, so every session issued before
 * now is refused, and re-issues this device's session (a new cookie in the response) so it
 * stays signed in. 204 on success.
 */
export async function POST() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  if (!limits.revokeSessions.hit(userId).ok) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  const version = await users.revokeSessions(userId);
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
