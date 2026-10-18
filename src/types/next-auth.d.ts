import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    /** The user's session version this session was issued with (src/lib/auth/session-version.ts). */
    sessionVersion?: number;
  }

  interface User {
    /** Set by the Credentials provider at sign-in, so the new JWT carries it. */
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    sessionVersion?: number;
  }
}
