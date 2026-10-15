export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  /** Queue a value; the latest one wins and is saved after `delayMs` of quiet. */
  schedule(value: T): void;
  /** Save any queued value now. Resolves once it (and any in-flight save) is done. */
  flush(): Promise<void>;
  cancel(): void;
  readonly status: SaveStatus;
}

/**
 * Debounced, serialized saver: never runs two saves at once, and never drops the
 * newest value. If a save is in flight when another is due, the newer value is
 * saved right after it finishes.
 */
// Flushes of mounted autosavers, run before the session ends. Signing out clears the cookie
// before the editor unmounts, so a save left for its unmount cleanup would get a 401.
const pendingSaves = new Set<() => Promise<void>>();

/** Registers a flush to run before sign-out. Returns a function that unregisters it. */
export function registerPendingSave(flush: () => Promise<void>): () => void {
  pendingSaves.add(flush);
  return () => void pendingSaves.delete(flush);
}

/**
 * Runs every registered flush and resolves when they have all settled, or after `timeoutMs`
 * so that a hung request cannot stop the writer signing out. Never rejects.
 */
export async function flushPendingSaves(timeoutMs = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  const all = Promise.allSettled([...pendingSaves].map(async (flush) => flush()));
  await Promise.race([all, timeout]);
  clearTimeout(timer);
}

export function createAutosaver<T>(
  save: (value: T) => Promise<void>,
  { delayMs = 800, onStatus }: { delayMs?: number; onStatus?: (status: SaveStatus) => void } = {},
): Autosaver<T> {
  let status: SaveStatus = "idle";
  let queued: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const setStatus = (next: SaveStatus) => {
    status = next;
    onStatus?.(next);
  };

  const run = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (inFlight) {
      await inFlight;
      return run();
    }
    if (!queued) return;
    const { value } = queued;
    queued = null;
    setStatus("saving");
    inFlight = save(value).then(
      () => setStatus(queued ? "pending" : "saved"),
      () => setStatus("error"),
    );
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (queued && !timer) return run();
  };

  return {
    schedule(value) {
      queued = { value };
      setStatus("pending");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      queued = null;
    },
    get status() {
      return status;
    },
  };
}
