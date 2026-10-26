import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import { requireUserSession } from "@/lib/auth/session";
import { limits, RATE_LIMITED_MESSAGE } from "@/lib/auth/limits";
import { reissueSession } from "@/lib/auth/session-version";
import { crossSiteRefusal, readJson, SMALL_BODY_BYTES } from "@/lib/http/request";
import { users } from "@/lib/users";
import { changePasswordSchema } from "@/lib/users/schema";
import {
  IncorrectPasswordError,
  PasswordBusyError,
  SessionRevokedError,
} from "@/lib/users/service";

/**
 * Body: { currentPassword, newPassword }. 204 on success. Every other device is signed out
 * (the session version goes up with the new password); this one gets a new session cookie in
 * the response and stays signed in.
 */
export async function POST(req: Request) {
  const session = await requireUserSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;
  const refused = crossSiteRefusal(req);
  if (refused) return refused;
  const body = await readJson(req, SMALL_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = changePasswordSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!limits.changePassword.hit(userId).ok) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  let version: number;
  try {
    version = await users.changePassword(
      userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      session.sessionVersion,
    );
  } catch (e) {
    // Revoked since the check above (from another device): signed out like the rest.
    if (e instanceof SessionRevokedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof IncorrectPasswordError) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    if (e instanceof PasswordBusyError) {
      return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
    }
    throw e;
  }
  // The password has changed either way; if this fails, this device is signed out too and
  // signs in again with the new password.
  if (!(await reissueSession(userId, version, unstable_update))) {
    console.error("Password change: could not re-issue the current session");
  }
  return new NextResponse(null, { status: 204 });
}
