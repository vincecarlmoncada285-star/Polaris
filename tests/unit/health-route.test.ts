import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
// The health check must never need a session: if it asked for one, this would throw.
vi.mock("@/lib/auth/session", () => ({
  requireUser: () => {
    throw new Error("the health check must not need a session");
  },
}));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  db.$queryRaw.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("is 200 { ok: true } when the database answers, and never cached", async () => {
    db.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("is 503 { ok: false } when the database fails, saying nothing about why", async () => {
    db.$queryRaw.mockRejectedValue(
      new Error("Error querying the database: unable to open database file /data/polaris.db"),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false });
    expect(text).not.toContain("polaris.db");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Logged as a fixed label, without the error's details.
    expect(console.error).toHaveBeenCalledWith("Health check: the database did not answer");
  });

  it("is 503 when the database does not answer within 3 seconds", async () => {
    vi.useFakeTimers();
    db.$queryRaw.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
