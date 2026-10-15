import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { SIGN_IN_PATH } from "@/lib/auth/routes";

// A signed session whose account is gone would loop: pages send it to /signin, middleware
// (which trusts the JWT) sends it back. Clearing the cookie needs a route handler or an
// action. This only ever signs out sessions with no account behind them, so it is safe as GET.
export async function GET() {
  if (await getCurrentUser()) redirect("/");
  if (await auth()) await signOut({ redirectTo: SIGN_IN_PATH });
  redirect(SIGN_IN_PATH);
}
