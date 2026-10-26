import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutosaver,
  flushPendingSaves,
  registerPendingSave,
  RETRY_DELAYS_MS,
} from "@/lib/autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosaver", () => {
  it("debounces to the latest value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 100 });
    saver.schedule(1);
    saver.schedule(2);
    saver.schedule(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
    expect(saver.status).toBe("saved");
  });

  it("never runs saves concurrently and saves the newest value afterwards", async () => {
    let resolveFirst!: () => void;
    let running = 0;
    let maxRunning = 0;
    const save = vi.fn((v: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      const done = () => void running--;
      return v === 1
        ? new Promise<void>((r) => (resolveFirst = () => (done(), r())))
        : Promise.resolve().then(done);
    });
    const saver = createAutosaver(save, { delayMs: 10 });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(10);
    expect(save.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(maxRunning).toBe(1);
  });

  it("flush saves immediately", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 10_000 });
    saver.schedule("x");
    await saver.flush();
    expect(save).toHaveBeenCalledWith("x");
  });

  it("reports errors", async () => {
    const statuses: string[] = [];
    const saver = createAutosaver(() => Promise.reject(new Error("nope")), {
      delayMs: 1,
      onStatus: (s) => statuses.push(s),
    });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses).toEqual(["pending", "saving", "error"]);
  });
});

describe("failed saves", () => {
  it("keeps the failed value and retries it on a backoff, with no new edit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 10 });
    saver.schedule("edit");
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.status).toBe("error");
    expect(saver.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(save.mock.calls.map((c) => c[0])).toEqual(["edit", "edit"]);
    expect(saver.status).toBe("saved");
    expect(saver.unsaved).toBe(false);
  });

  it("retries a failed value on flush (sign-out, leaving the page)", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 10, retryAfterMs: () => null });
    saver.schedule("edit");
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.status).toBe("error");
    expect(await saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not retry by itself when told not to, and flush reports what is left", async () => {
    const save = vi.fn().mockRejectedValue(new Error("conflict"));
    const saver = createAutosaver(save, { delayMs: 10, retryAfterMs: () => null });
    saver.schedule("edit");
    await vi.advanceTimersByTimeAsync(10 + 120_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await saver.flush()).toBe(false);
    expect(saver.unsaved).toBe(true);
  });

  it("saves a newer value instead of the failed one", async () => {
    let fail!: (e: Error) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)))
      .mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 10 });
    saver.schedule("old");
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule("new");
    fail(new Error("offline"));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(save.mock.calls.map((c) => c[0])).toEqual(["old", "new"]);
    expect(saver.status).toBe("saved");
  });

  it("waits as long as the server asks after a rate limit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 10, retryAfterMs: () => 30_000 });
    saver.schedule("edit");
    await vi.advanceTimersByTimeAsync(10 + 29_000);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("flushPendingSaves (before sign-out)", () => {
  it("saves what a registered autosaver has queued, then resolves", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createAutosaver(save, { delayMs: 800 });
    const unregister = registerPendingSave(() => saver.flush());
    saver.schedule("typed just now");
    await flushPendingSaves();
    expect(save).toHaveBeenCalledWith("typed just now");
    expect(saver.status).toBe("saved");
    unregister();
  });

  it("waits for a save that is already in flight", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const saver = createAutosaver(save, { delayMs: 10 });
    const unregister = registerPendingSave(() => saver.flush());
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    let done = false;
    const flushed = flushPendingSaves().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    finish();
    await flushed;
    expect(saver.status).toBe("saved");
    unregister();
  });

  it("resolves false when a save is still failing, so sign-out can warn", async () => {
    const saver = createAutosaver(() => Promise.reject(new Error("offline")), { delayMs: 800 });
    const unregister = registerPendingSave(() => saver.flush());
    saver.schedule("typed just now");
    expect(await flushPendingSaves()).toBe(false);
    unregister();
    saver.cancel();
  });

  it("skips unregistered autosavers", async () => {
    const flush = vi.fn().mockResolvedValue(true);
    registerPendingSave(flush)();
    await flushPendingSaves();
    expect(flush).not.toHaveBeenCalled();
  });

  it("gives up after the timeout, and never rejects", async () => {
    const unregisterHung = registerPendingSave(() => new Promise<boolean>(() => {}));
    const unregisterBroken = registerPendingSave(() => {
      throw new Error("broken");
    });
    let done = false;
    const flushed = flushPendingSaves(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // `done` is set once flushPendingSaves settles: it gave up instead of hanging.
    await flushed;
    expect(done).toBe(true);
    unregisterHung();
    unregisterBroken();
  });
});
