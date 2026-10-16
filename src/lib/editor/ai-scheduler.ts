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
  | { kind: "error"; reason: "rate_limited" | "failed" };

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
  /** How long a paragraph's text must stay unchanged before it is sent. */
  idleMs?: number;
  minWords?: number;
  maxInFlight?: number;
  /** A paragraph whose request failed (5xx, network) is tried again after this long. */
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

  const texts = new Map<string, string>(); // key -> paragraph text, for scheduled work
  const cache = new Map<string, RuleMatch[]>(); // LRU: insertion order is recency
  const idleTimers = new Map<string, unknown>();
  const queue: string[] = []; // idle long enough, waiting for a free slot
  const inFlight = new Map<string, AbortController>();
  const failedUntil = new Map<string, number>(); // key -> when it may be tried again
  let backoffUntil = 0;
  let backoffTimer: unknown = null;
  let lastError: "failed" | null = null;
  let stopped: Extract<AiStatus, { kind: "unavailable" }> | null = null;
  let disposed = false;
  let lastStatus: AiStatus = { kind: "idle" };
  let lastResults = new Map<string, RuleMatch[]>();

  const eligible = (text: string) =>
    text.length <= AI_MAX_PARAGRAPH_CHARS && countWords(text) >= minWords;

  function computeStatus(): AiStatus {
    if (stopped) return stopped;
    if (now() < backoffUntil) return { kind: "error", reason: "rate_limited" };
    const count = inFlight.size + queue.length;
    if (count > 0) return { kind: "checking", count };
    if (lastError) return { kind: "error", reason: lastError };
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

  function cancelAll() {
    for (const handle of idleTimers.values()) timers.clearTimeout(handle);
    idleTimers.clear();
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
    const text = texts.get(key)!;
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
        failedUntil.delete(key);
        lastError = null;
        emitResults();
        break;
      case "rate_limited":
        queue.unshift(key);
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
        failedUntil.set(key, outcome.permanent ? Infinity : now() + retryFailedAfterMs);
        lastError = "failed";
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

      const wanted = new Map<string, string>();
      for (const text of paragraphs) if (eligible(text)) wanted.set(keyOf(text), text);

      // Work for text that is no longer on the page (edited, deleted, or new goals) stops.
      for (const [key, handle] of idleTimers) {
        if (wanted.has(key)) continue;
        timers.clearTimeout(handle);
        idleTimers.delete(key);
      }
      for (let i = queue.length - 1; i >= 0; i--) if (!wanted.has(queue[i]!)) queue.splice(i, 1);
      for (const [key, controller] of inFlight) {
        if (wanted.has(key)) continue;
        controller.abort();
        inFlight.delete(key);
      }
      for (const key of texts.keys()) {
        if (!wanted.has(key)) texts.delete(key);
      }

      // New text waits until it has been left alone for idleMs; unchanged text keeps its timer.
      const t = now();
      for (const [key, text] of wanted) {
        if (cache.has(key) || idleTimers.has(key) || inFlight.has(key) || queue.includes(key)) {
          continue;
        }
        const retryAt = failedUntil.get(key);
        if (retryAt !== undefined) {
          if (retryAt > t) continue;
          failedUntil.delete(key);
        }
        texts.set(key, text);
        idleTimers.set(
          key,
          timers.setTimeout(() => {
            idleTimers.delete(key);
            queue.push(key);
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
