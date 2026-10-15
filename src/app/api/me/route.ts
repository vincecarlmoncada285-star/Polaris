import { NextResponse } from "next/server";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { users } from "@/lib/users";
import { deleteAccountSchema, emailSchema, updateProfileSchema } from "@/lib/users/schema";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const user = await users.getUser(userId);
  return user ? NextResponse.json(user) : unauthorized();
}

export async function PATCH(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const parsed = updateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const user = await users.updateProfile(userId, parsed.data);
  return user ? NextResponse.json(user) : unauthorized();
}

/** Body: { email } — the account's email, typed by the user to confirm. */
export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const parsed = deleteAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await users.getUser(userId);
  if (!user) return unauthorized();
  const typed = emailSchema.safeParse(parsed.data.email);
  if (!typed.success || typed.data !== user.email) {
    return NextResponse.json(
      { error: "Type your account email exactly to confirm." },
      { status: 400 },
    );
  }

  await users.deleteUser(userId);
  // Clear the session cookie in this response, so the browser is signed out even if the
  // page never gets to navigate away.
  await signOut({ redirect: false });
  return new NextResponse(null, { status: 204 });
}
