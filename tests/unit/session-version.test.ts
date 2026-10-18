import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import type { JWT } from "next-auth/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A real database (a fresh SQLite file); Auth.js itself is a stand-in: `auth()` returns
// whatever session the test sets, and `unstable_update` runs the jwt callback the way Auth.js
// would, so the routes' re-issue goes through the same code as in the app.
const testDb = vi.hoisted(async () => (await import("./test-db")).createTestDb());
vi.mock("@/lib/db", async () => ({ prisma: (await testDb).db }));
const authState = vi.hoisted(() => ({
  session: null as { user: { id: string }; sessionVersion?: number } | null,
  token: null as JWT | null,
}));
vi.mock("@/auth", async () => {
  const { applyReissue } = await import("@/lib/auth/session-version");
  return {
    auth: vi.fn(async () => authState.session),
    // As Auth.js's update: the jwt callback with trigger "update" (src/auth.ts), then the
    // session callback, and the new cookie.
    unstable_update: vi.fn(async () => {
      if (!authState.token) return null;
      authState.token = applyReissue(authState.token);
      return { user: { id: authState.token.id }, sessionVersion: authState.token.sessionVersion };
    }),
  };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

import { POST as changePassword } from "@/app/api/me/password/route";
import { POST as signOutOthers } from "@/app/api/me/sign-out-others/route";
import { unstable_update } from "@/auth";
import { limits } from "@/lib/auth/limits";
import { getCurrentUser, requirePageUser, requireUser } from "@/lib/auth/session";
import { applyReissue, reissueSession, sessionVersionMatches } from "@/lib/auth/session-version";
import { createUserService } from "@/lib/users/service";

vi.setConfig({ testTimeout: 30_000 });

let db: PrismaClient;
let cleanup: () => Promise<void>;
let service: ReturnType<typeof createUserService>;
let counter = 0;
const PASSWORD = "correct horse battery";

beforeAll(async () => {
  ({ db, cleanup } = await testDb);
  service = createUserService(db);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  authState.session = null;
  authState.token = null;
  vi.mocked(unstable_update).mockClear();
  limits.changePassword.reset();
  limits.revokeSessions.reset();
});

async function newUser() {
  return service.createUser({ email: `session${++counter}@example.com`, password: PASSWORD });
}

/** Signs `userId` in "on this device" with a JWT issued at `version`. */
function signedInAs(userId: string, version: number | undefined) {
  authState.token = { id: userId, sessionVersion: version };
  authState.session = { user: { id: userId }, sessionVersion: version };
}

/** What the session helpers see once the device's cookie is the re-issued token. */
function adoptReissuedToken() {
  const token = authState.token!;
  authState.session = { user: { id: token.id! }, sessionVersion: token.sessionVersion };
}

describe("sessionVersionMatches", () => {
  it("accepts only the user's current version", () => {
    expect(sessionVersionMatches(0, 0)).toBe(true);
    expect(sessionVersionMatches(3, 3)).toBe(true);
    expect(sessionVersionMatches(2, 3)).toBe(false);
    expect(sessionVersionMatches(4, 3)).toBe(false);
  });

  it("reads a JWT from before versions existed as version 0", () => {
    expect(sessionVersionMatches(undefined, 0)).toBe(true);
    expect(sessionVersionMatches(undefined, 1)).toBe(false);
    for (const odd of [null, "0", "3", NaN, {}]) {
      expect(sessionVersionMatches(odd, 3)).toBe(false);
    }
  });
});

describe("applyReissue (the jwt callback on an update)", () => {
  const token: JWT = { id: "user-1", sessionVersion: 1, email: "a@example.com" };

  it("ignores an update nobody on the server asked for (POST /api/auth/session)", () => {
    expect(applyReissue(token)).toBe(token);
  });

  it("moves the token to the new version inside reissueSession, for that user only", async () => {
    const seen: JWT[] = [];
    await reissueSession("user-1", 2, async () => {
      seen.push(applyReissue(token), applyReissue({ ...token, id: "user-2" }), applyReissue({}));
      return null;
    });
    expect(seen[0]).toEqual({ ...token, sessionVersion: 2 });
    expect(seen[1]).toEqual({ ...token, id: "user-2" });
    expect(seen[2]).toEqual({});
    // And not after it returns.
    expect(applyReissue(token)).toBe(token);
  });

  it("reports whether the session came back with the new version", async () => {
    expect(await reissueSession("u", 2, async () => ({ sessionVersion: 2 }))).toBe(true);
    expect(await reissueSession("u", 2, async () => ({ sessionVersion: 1 }))).toBe(false);
    expect(await reissueSession("u", 2, async () => null)).toBe(false);
  });
});

describe("session helpers", () => {
  it("accept a session issued with the user's current version", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    expect(await getCurrentUser()).toEqual(user);
    expect(await requireUser()).toBe(user.id);
    expect(await requirePageUser("/")).toEqual(user);
  });

  it("treat a session with another version as signed out: 401, and /session/expired", async () => {
    const user = await newUser();
    await service.revokeSessions(user.id);
    for (const stale of [0, undefined, 2]) {
      signedInAs(user.id, stale);
      expect(await getCurrentUser()).toBeNull();
      const res = await requireUser();
      expect(res).toBeInstanceOf(NextResponse);
      expect((res as NextResponse).status).toBe(401);
      expect(await (res as NextResponse).json()).toEqual({ error: "Unauthorized" });
      // The page flow that clears the cookie and goes to /signin.
      await expect(requirePageUser("/settings")).rejects.toThrow("redirect:/session/expired");
    }
    signedInAs(user.id, 1);
    expect(await requireUser()).toBe(user.id);
  });

  it("send a visitor with no session to sign in, not to /session/expired", async () => {
    await expect(requirePageUser("/settings")).rejects.toThrow(
      "redirect:/signin?callbackUrl=%2Fsettings",
    );
  });
});

describe("POST /api/me/password", () => {
  const body = (currentPassword: string, newPassword: string) =>
    new Request("http://localhost/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });

  it("bumps the version, re-issues this device's session with it, and refuses the others", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    const res = await changePassword(body(PASSWORD, "a much better passphrase"));
    expect(res.status).toBe(204);
    expect(unstable_update).toHaveBeenCalledTimes(1);
    expect(authState.token?.sessionVersion).toBe(1);

    // Another device still holds a version-0 token.
    authState.session = { user: { id: user.id }, sessionVersion: 0 };
    expect(((await requireUser()) as NextResponse).status).toBe(401);
    // This one has the re-issued token.
    adoptReissuedToken();
    expect(await requireUser()).toBe(user.id);
  });

  it("leaves the version alone when the current password is wrong", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    const res = await changePassword(body("not the password", "a much better passphrase"));
    expect(res.status).toBe(400);
    expect(unstable_update).not.toHaveBeenCalled();
    expect((await service.getSessionUser(user.id))?.sessionVersion).toBe(0);
    expect(await requireUser()).toBe(user.id);
  });
});

describe("POST /api/me/sign-out-others", () => {
  const post = () => signOutOthers();

  it("signs out every other session and keeps this one", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    expect((await post()).status).toBe(204);
    expect((await service.getSessionUser(user.id))?.sessionVersion).toBe(1);
    authState.session = { user: { id: user.id }, sessionVersion: 0 };
    expect(((await requireUser()) as NextResponse).status).toBe(401);
    adoptReissuedToken();
    expect(await requireUser()).toBe(user.id);

    // Again: the device that asked keeps up, so it can ask again.
    expect((await post()).status).toBe(204);
    adoptReissuedToken();
    expect(authState.session?.sessionVersion).toBe(2);
    expect(await requireUser()).toBe(user.id);
  });

  it("needs a current session", async () => {
    const user = await newUser();
    await service.revokeSessions(user.id);
    signedInAs(user.id, 0);
    expect((await post()).status).toBe(401);
    expect((await service.getSessionUser(user.id))?.sessionVersion).toBe(1);
  });

  it("is rate limited per user: 5 in 15 minutes", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    for (let i = 0; i < 5; i++) {
      expect((await post()).status).toBe(204);
      adoptReissuedToken();
    }
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "Too many attempts. Try again later." });
    expect((await service.getSessionUser(user.id))?.sessionVersion).toBe(5);
    // Another user is not affected.
    const other = await newUser();
    signedInAs(other.id, 0);
    expect((await post()).status).toBe(204);
  });

  it("says so when this device's session could not be re-issued", async () => {
    const user = await newUser();
    signedInAs(user.id, 0);
    vi.mocked(unstable_update).mockResolvedValueOnce(null);
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "You were signed out on this device too. Sign in again.",
    });
  });
});
