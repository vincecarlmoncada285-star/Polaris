export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  /** Queue a value; the latest one wins and is saved after `delayMs` of quiet. */
  schedule(value: T): void;
  /**
   * Save any queued value now, including one whose last attempt failed. Resolves once it (and
   * any in-flight save) is done, true if nothing is left unsaved.
   */
  flush(): Promise<boolean>;
  cancel(): void;
  readonly status: SaveStatus;
  /** Something is queued, in flight, or failed and waiting for a retry. */
  readonly unsaved: boolean;
}

// Flushes of mounted autosavers, run before the session ends. Signing out clears the cookie
// before the editor unmounts, so a save left for its unmount cleanup would get a 401.
const pendingSaves = new Set<() => Promise<boolean>>();

/** Registers a flush to run before sign-out. Returns a function that unregisters it. */
export function registerPendingSave(flush: () => Promise<boolean>): () => void {
  pendingSaves.add(flush);
  return () => void pendingSaves.delete(flush);
}

/**
 * Runs every registered flush and resolves when they have all settled, or after `timeoutMs`
 * so that a hung request cannot stop the writer signing out. Never rejects. True only if
 * every flush finished with nothing left unsaved.
 */
export async function flushPendingSaves(timeoutMs = 5000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(
    (resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)),
  );
  const all = Promise.allSettled([...pendingSaves].map(async (flush) => flush())).then((results) =>
    results.every((r) => r.status === "fulfilled" && r.value),
  );
  const saved = await Promise.race([all, timeout]);
  clearTimeout(timer);
  return saved;
}

/** Waits between automatic retries of a failed save: soon at first, then less often. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * Debounced, serialized saver: never runs two saves at once, and never drops the newest
 * value. If a save is in flight when another is due, the newer value is saved right after it
 * finishes. A failed save keeps its value queued (unless a newer one replaced it) and is
 * retried on a backoff, and by the next flush(), so a network blip or a server restart loses
 * nothing. `retryAfterMs(error)` decides: a number of milliseconds to wait, undefined for the
 * usual backoff, or null for no automatic retry (a conflict the writer must resolve, say).
 */
export function createAutosaver<T>(
  save: (value: T) => Promise<void>,
  {
    delayMs = 800,
    onStatus,
    retryAfterMs = () => undefined,
  }: {
    delayMs?: number;
    onStatus?: (status: SaveStatus) => void;
    retryAfterMs?: (error: unknown) => number | null | undefined;
  } = {},
): Autosaver<T> {
  let status: SaveStatus = "idle";
  let queued: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let failures = 0;

  const setStatus = (next: SaveStatus) => {
    status = next;
    onStatus?.(next);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = async (): Promise<boolean> => {
    clearTimer();
    if (inFlight) {
      await inFlight;
      return run();
    }
    if (!queued) return status !== "error";
    const { value } = queued;
    queued = null;
    setStatus("saving");
    inFlight = save(value).then(
      () => {
        failures = 0;
        setStatus(queued ? "pending" : "saved");
      },
      (error: unknown) => {
        // Keep the failed value unless something newer is already waiting to be saved.
        queued ??= { value };
        setStatus("error");
        const wait = retryAfterMs(error);
        if (wait === null) return;
        const delay = wait ?? RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]!;
        failures++;
        clearTimer();
        timer = setTimeout(() => void run(), delay);
      },
    );
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (queued && status !== "error" && !timer) return run();
    return !queued && status !== "error";
  };

  return {
    schedule(value) {
      queued = { value };
      setStatus("pending");
      clearTimer();
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      clearTimer();
      queued = null;
    },
    get status() {
      return status;
    },
    get unsaved() {
      return queued !== null || inFlight !== null;
    },
  };
}
