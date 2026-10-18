import { NextResponse } from "next/server";
import { unstable_update } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { limits, RATE_LIMITED_MESSAGE } from "@/lib/auth/limits";
import { reissueSession } from "@/lib/auth/session-version";
import { users } from "@/lib/users";
import { changePasswordSchema } from "@/lib/users/schema";
import { IncorrectPasswordError } from "@/lib/users/service";

/**
 * Body: { currentPassword, newPassword }. 204 on success. Every other device is signed out
 * (the session version goes up with the new password); this one gets a new session cookie in
 * the response and stays signed in.
 */
export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const parsed = changePasswordSchema.safeParse(await req.json().catch(() => null));
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
    );
  } catch (e) {
    if (e instanceof IncorrectPasswordError) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
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
