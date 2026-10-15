import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { clientIp, limits } from "@/lib/auth/limits";
import { users } from "@/lib/users";

/** Thrown from `authorize` so the sign-in form can say "try later" rather than "incorrect". */
export class RateLimitedSignIn extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().max(1024),
  password: z.string().min(1).max(1024),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Edge-safe providers (OAuth) from auth.config.ts, then the ones that need Node.
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Also reachable directly at POST /api/auth/callback/credentials, so the rate limit
      // lives here rather than in the sign-in form's server action.
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        if (!limits.allowSignIn(email, clientIp(request.headers))) throw new RateLimitedSignIn();
        const user = await users.verifyCredentials(email, password);
        return user ? { id: user.id, email: user.email, name: user.name } : null;
      },
    }),
  ],
  logger: {
    // A failed sign-in is expected traffic, not a server error worth a stack trace.
    error(error) {
      if (error instanceof CredentialsSignin) return;
      console.error(error);
    },
  },
});
