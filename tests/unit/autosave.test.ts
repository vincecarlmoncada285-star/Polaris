import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "@/lib/autosave";

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
