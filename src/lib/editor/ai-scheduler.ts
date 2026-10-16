// Decides when to ask the server for AI feedback on which paragraphs. Framework-free: the
// editor feeds it the current paragraph texts on every change, and fetch and timers are
// injected so tests can drive it with fake timers.
import {
  AI_MAX_PARAGRAPH_CHARS,
  AI_MAX_TITLE_CHARS,
  AI_PARAGRAPH_ENDPOINT,
  type AiErrorBody,
  type ParagraphRequest,
  type ParagraphResponse,
} from "@/lib/ai/protocol";
import type { WritingGoals } from "@/lib/documents/schema";
import { CATEGORIES, type RuleMatch } from "@/lib/rules/types";
import { countWords } from "@/lib/text/stats";

export type AiStatus =
  | { kind: "idle" }
  | { kind: "checking"; count: number }
  /** The server said no for good: AI is switched off, not set up, or the session ended. */
  | { kind: "unavailable"; reason: "disabled" | "not_configured" | "signed_out" }
  /** Too many requests: nothing is sent before `until` (a timestamp, as from `now`). */
  | { kind: "error"; reason: "rate_limited"; until: number }
  /** A paragraph on the page could not be checked. It is tried again later. */
  | { kind: "error"; reason: "failed" };

export interface AiSnapshot {
  /** Every textblock's text, in document order (collectTextBlocks). */
  paragraphs: string[];
  goals: WritingGoals;
  title?: string;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AiSchedulerOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timers?: Timers;
  now?: () => number;
  /** Results for the current paragraphs and goals, keyed by paragraph text. */
  onResults?: (matches: Map<string, RuleMatch[]>) => void;
  onStatus?: (status: AiStatus) => void;
  /**
   * The paragraph texts of the document as it was opened. They are not sent until the writer
   * changes them, so only text the writer is working on goes to Claude.
   */
  loaded?: Iterable<string>;
  /** How long a paragraph's text must stay unchanged before it is sent. */
  idleMs?: number;
  minWords?: number;
  maxInFlight?: number;
  /**
   * A paragraph whose request failed (5xx, network) is tried again after this long, and after
   * twice as long on each further failure (at most 16 times as long).
   */
  retryFailedAfterMs?: number;
  /** Used when a 429 carries no usable Retry-After. */
  defaultBackoffMs?: number;
  cacheSize?: number;
  endpoint?: string;
}

export interface AiScheduler {
  update(snapshot: AiSnapshot): void;
  dispose(): void;
  readonly status: AiStatus;
}

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

function goalsKey(goals: WritingGoals): string {
  const entries = Object.entries(goals)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}

/** Server suggestions as rule-shaped matches, dropping anything that does not fit `text`. */
export function toMatches(text: string, suggestions: unknown): RuleMatch[] {
  if (!Array.isArray(suggestions)) return [];
  const out: RuleMatch[] = [];
  for (const s of suggestions as Partial<Record<string, unknown>>[]) {
    const { start, end, category, message, explanation, replacements } = s ?? {};
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < 0 ||
      (end as number) <= (start as number) ||
      (end as number) > text.length ||
      typeof category !== "string" ||
      !CATEGORY_IDS.has(category) ||
      typeof message !== "string" ||
      typeof explanation !== "string" ||
      !Array.isArray(replacements) ||
      !replacements.every((r) => typeof r === "string")
    ) {
      continue;
    }
    out.push({
      ruleId: "ai",
      category: category as RuleMatch["category"],
      start: start as number,
      end: end as number,
      message,
      explanation,
      replacements: replacements as string[],
    });
  }
  return out;
}

type Outcome =
  | { kind: "ok"; matches: RuleMatch[] }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "stop"; status: Extract<AiStatus, { kind: "unavailable" }> }
  | { kind: "failed"; permanent: boolean };

export function createAiScheduler({
  fetch: fetchFn = (url, init) => globalThis.fetch(url, init),
  timers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  now = Date.now,
  onResults,
  onStatus,
  loaded = [],
  idleMs = 1500,
  minWords = 8,
  maxInFlight = 2,
  retryFailedAfterMs = 30_000,
  defaultBackoffMs = 30_000,
  cacheSize = 500,
  endpoint = AI_PARAGRAPH_ENDPOINT,
}: AiSchedulerOptions = {}): AiScheduler {
  // Everything is keyed by goals + text, so changing the goals makes every paragraph new.
  let goals: WritingGoals = {};
  let currentGoalsKey = goalsKey(goals);
  let title = "";
  let paragraphs: string[] = [];
  const keyOf = (text: string) => `${currentGoalsKey}\u0000${text}`;
  const untouched = new Set(loaded);

  let wanted = new Map<string, string>(); // key -> text, for every paragraph that may be sent
  const cache = new Map<string, RuleMatch[]>(); // LRU: insertion order is recency
  const idleTimers = new Map<string, unknown>();
  const queue: string[] = []; // idle long enough, waiting for a free slot
  const inFlight = new Map<string, AbortController>();
  // When each wanted text appeared (an update() count), so the latest edit is sent first.
  const editedAt = new Map<string, number>();
  let updates = 0;
  const failed = new Set<string>(); // last request failed: retried by its timer, or never
  const failures = new Map<string, number>(); // consecutive failures, for the retry delay
  const retryTimers = new Map<string, unknown>();
  let backoffUntil = 0;
  let backoffTimer: unknown = null;
  let stopped: Extract<AiStatus, { kind: "unavailable" }> | null = null;
  let disposed = false;
  let lastStatus: AiStatus = { kind: "idle" };
  let lastResults = new Map<string, RuleMatch[]>();

  const eligible = (text: string) =>
    !untouched.has(text) && text.length <= AI_MAX_PARAGRAPH_CHARS && countWords(text) >= minWords;

  function computeStatus(): AiStatus {
    if (stopped) return stopped;
    if (now() < backoffUntil) return { kind: "error", reason: "rate_limited", until: backoffUntil };
    const count = inFlight.size + queue.length;
    if (count > 0) return { kind: "checking", count };
    // Only failures on text still on the page count: an edit or a deletion clears them.
    for (const key of failed) if (wanted.has(key)) return { kind: "error", reason: "failed" };
    return { kind: "idle" };
  }

  function emitStatus() {
    const next = computeStatus();
    if (JSON.stringify(next) === JSON.stringify(lastStatus)) return;
    lastStatus = next;
    onStatus?.(next);
  }

  /** Tells the editor only when the set of results for the current paragraphs changed. */
  function emitResults() {
    const next = new Map<string, RuleMatch[]>();
    for (const text of paragraphs) {
      const matches = cache.get(keyOf(text));
      if (matches) next.set(text, matches);
    }
    const same =
      next.size === lastResults.size &&
      [...next].every(([text, matches]) => lastResults.get(text) === matches);
    if (same) return;
    lastResults = next;
    onResults?.(next);
  }

  function remember(key: string, matches: RuleMatch[]) {
    cache.delete(key);
    cache.set(key, matches);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
  }

  /** Into the queue: the most recently edited text first, otherwise in the order it got due. */
  function enqueue(key: string) {
    const at = editedAt.get(key) ?? 0;
    const i = queue.findIndex((k) => (editedAt.get(k) ?? 0) < at);
    if (i === -1) queue.push(key);
    else queue.splice(i, 0, key);
  }

  /** Tries a failed paragraph again later, by itself: the writer may not edit it again. */
  function scheduleRetry(key: string) {
    const attempt = (failures.get(key) ?? 0) + 1;
    failures.set(key, attempt);
    const delay = retryFailedAfterMs * 2 ** Math.min(attempt - 1, 4);
    retryTimers.set(
      key,
      timers.setTimeout(() => {
        retryTimers.delete(key);
        failed.delete(key);
        if (!wanted.has(key)) {
          // Gone from the page: if it comes back, it starts afresh.
          failures.delete(key);
        } else if (!cache.has(key) && !idleTimers.has(key) && !inFlight.has(key)) {
          if (!queue.includes(key)) enqueue(key);
        }
        pump();
      }, delay),
    );
  }

  function cancelAll() {
    for (const handle of idleTimers.values()) timers.clearTimeout(handle);
    idleTimers.clear();
    for (const handle of retryTimers.values()) timers.clearTimeout(handle);
    retryTimers.clear();
    queue.length = 0;
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    if (backoffTimer !== null) timers.clearTimeout(backoffTimer);
    backoffTimer = null;
  }

  function requestBody(text: string): ParagraphRequest {
    const body: ParagraphRequest = { text, goals };
    const trimmedTitle = title.trim().slice(0, AI_MAX_TITLE_CHARS);
    if (trimmedTitle) body.title = trimmedTitle;
    const index = paragraphs.indexOf(text);
    const previous = index > 0 ? paragraphs[index - 1]! : "";
    // The end of a long previous paragraph is the part that leads into this one.
    if (previous.trim()) body.previous = previous.slice(-AI_MAX_PARAGRAPH_CHARS);
    return body;
  }

  async function run(key: string, controller: AbortController): Promise<Outcome> {
    const text = wanted.get(key)!;
    let res: Response;
    try {
      res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(text)),
        signal: controller.signal,
      });
    } catch {
      return { kind: "failed", permanent: false };
    }
    if (res.status === 429) {
      const seconds = Number(res.headers.get("Retry-After"));
      const retryAfterMs =
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultBackoffMs;
      return { kind: "rate_limited", retryAfterMs };
    }
    if (res.status === 401) return { kind: "stop", status: unavailable("signed_out") };
    if (res.status === 403) return { kind: "stop", status: unavailable("disabled") };
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as AiErrorBody | null;
      if (body?.code === "ai_unavailable") {
        return { kind: "stop", status: unavailable("not_configured") };
      }
    }
    if (!res.ok) return { kind: "failed", permanent: res.status < 500 };
    try {
      const data = (await res.json()) as ParagraphResponse;
      return { kind: "ok", matches: toMatches(text, data.suggestions) };
    } catch {
      return { kind: "failed", permanent: false };
    }
  }

  function settle(key: string, controller: AbortController, outcome: Outcome) {
    // Cancelled (the text changed or disappeared) or disposed: the answer is for text that
    // is no longer on the page.
    if (disposed || inFlight.get(key) !== controller) return;
    inFlight.delete(key);
    switch (outcome.kind) {
      case "ok":
        remember(key, outcome.matches);
        failures.delete(key);
        emitResults();
        break;
      case "rate_limited":
        enqueue(key);
        backoffUntil = now() + outcome.retryAfterMs;
        if (backoffTimer !== null) timers.clearTimeout(backoffTimer);
        backoffTimer = timers.setTimeout(() => {
          backoffTimer = null;
          pump();
        }, outcome.retryAfterMs);
        break;
      case "stop":
        stopped = outcome.status;
        cancelAll();
        // AI cards next to "AI suggestions are off" would contradict it.
        if (lastResults.size > 0) {
          lastResults = new Map();
          onResults?.(lastResults);
        }
        break;
      case "failed":
        failed.add(key);
        if (!outcome.permanent) scheduleRetry(key);
        break;
    }
    pump();
  }

  function pump() {
    if (disposed || stopped) return emitStatus();
    if (now() >= backoffUntil) {
      while (inFlight.size < maxInFlight && queue.length > 0) {
        const key = queue.shift()!;
        if (cache.has(key) || inFlight.has(key)) continue;
        const controller = new AbortController();
        inFlight.set(key, controller);
        void run(key, controller).then((outcome) => settle(key, controller, outcome));
      }
    }
    emitStatus();
  }

  return {
    update(snapshot) {
      if (disposed || stopped) return;
      goals = snapshot.goals;
      currentGoalsKey = goalsKey(goals);
      title = snapshot.title ?? "";
      paragraphs = snapshot.paragraphs;
      updates++;

      const next = new Map<string, string>();
      for (const text of paragraphs) if (eligible(text)) next.set(keyOf(text), text);

      // Work for text that is no longer on the page (edited, deleted, or new goals) stops.
      for (const [key, handle] of idleTimers) {
        if (next.has(key)) continue;
        timers.clearTimeout(handle);
        idleTimers.delete(key);
      }
      for (let i = queue.length - 1; i >= 0; i--) if (!next.has(queue[i]!)) queue.splice(i, 1);
      for (const [key, controller] of inFlight) {
        if (next.has(key)) continue;
        controller.abort();
        inFlight.delete(key);
      }
      for (const key of editedAt.keys()) if (!next.has(key)) editedAt.delete(key);
      wanted = next;

      // New text waits until it has been left alone for idleMs; unchanged text keeps its timer.
      // A failed one waits for its retry timer.
      for (const key of wanted.keys()) {
        if (!editedAt.has(key)) editedAt.set(key, updates);
        if (cache.has(key) || idleTimers.has(key) || inFlight.has(key) || queue.includes(key)) {
          continue;
        }
        if (failed.has(key)) continue;
        idleTimers.set(
          key,
          timers.setTimeout(() => {
            idleTimers.delete(key);
            enqueue(key);
            pump();
          }, idleMs),
        );
      }

      emitResults();
      pump();
    },
    dispose() {
      disposed = true;
      cancelAll();
    },
    get status() {
      return computeStatus();
    },
  };
}

function unavailable(
  reason: Extract<AiStatus, { kind: "unavailable" }>["reason"],
): Extract<AiStatus, { kind: "unavailable" }> {
  return { kind: "unavailable", reason };
}
