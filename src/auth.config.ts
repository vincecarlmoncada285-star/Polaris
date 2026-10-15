import type { NextAuthConfig } from "next-auth";
import { routeDecision, SIGN_IN_PATH } from "@/lib/auth/routes";

/**
 * Edge-safe half of the Auth.js config, shared by middleware and `src/auth.ts`. It must not
 * import Prisma, bcrypt or anything else that needs Node: middleware bundles it. Providers
 * that need the database are added in `src/auth.ts`; OAuth providers, which do not, can be
 * listed here or there (see README, "Adding an OAuth provider").
 */
export const authConfig = {
  pages: { signIn: SIGN_IN_PATH },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    // Runs in middleware for every matched page request.
    authorized({ auth, request: { nextUrl } }) {
      const decision = routeDecision(nextUrl.pathname, nextUrl.search, !!auth?.user?.id);
      return decision.kind === "redirect" ? Response.redirect(new URL(decision.to, nextUrl)) : true;
    },
    jwt({ token, user }) {
      // `user` is only present on sign-in; afterwards the id rides along in the token.
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === "string") session.user.id = token.id;
      return session;
    },
  },
} satisfies NextAuthConfig;
