import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Only the edge-safe config: the `authorized` callback decides redirects from the JWT alone.
export default NextAuth(authConfig).auth;

export const config = {
  // Pages only. API routes authenticate themselves with requireUser(); static assets,
  // Next internals and the favicon never need a session.
  matcher: ["/((?!api/|_next/|favicon\\.ico$|.*\\.[A-Za-z0-9]+$).*)"],
};
