import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { limits, RATE_LIMITED_MESSAGE } from "@/lib/auth/limits";
import { users } from "@/lib/users";
import { changePasswordSchema } from "@/lib/users/schema";
import { IncorrectPasswordError } from "@/lib/users/service";

/** Body: { currentPassword, newPassword }. 204 on success. */
export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const parsed = changePasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!limits.changePassword.hit(userId).ok) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  try {
    await users.changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword);
  } catch (e) {
    if (e instanceof IncorrectPasswordError) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    throw e;
  }
  return new NextResponse(null, { status: 204 });
}
