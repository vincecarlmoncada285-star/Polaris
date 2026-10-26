"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import {
  REVIEW_CATEGORY_LABELS,
  REVIEW_MAX_WORDS,
  REVIEW_MIN_WORDS,
  reviewEndpoint,
  type DocumentReviewDTO,
  type ReviewErrorBody,
  type ReviewResponse,
} from "@/lib/ai/protocol";
import { formatNumber } from "@/lib/text/format";

/** Exactly what a review sends: the Settings text says the same. */
export const REVIEW_SENDS =
  "Polaris sends this whole document with its footnotes, its title and your writing goals to Anthropic's Claude API";
export const REVIEW_RUNNING = "Reviewing your document. This can take a minute or two.";
export const REVIEW_STALE = "You have edited the document since this review.";
const NETWORK_ERROR = "Couldn’t reach Polaris. Check your connection and try again.";
const SAVE_ERROR =
  "Polaris couldn’t save your latest changes, so a review would miss them. Check your connection and try again.";
const FAILED = "Claude couldn’t finish the review just now. Try again in a few minutes.";

/** Whether this writer can ask for a review here: their AI setting, and the server's key. */
export interface ReviewAvailability {
  enabled: boolean;
  configured: boolean;
}

interface ReviewError {
  message: string;
  /** Point to Settings, where AI is switched on. */
  settings?: boolean;
}

/** When the writer may ask again, for a Retry-After of `seconds`. */
export function retryWhen(seconds: number, now = Date.now()): string {
  if (!Number.isFinite(seconds) || seconds <= 60) return "in a minute";
  if (seconds < 60 * 60) return `in about ${Math.ceil(seconds / 60)} minutes`;
  const at = new Date(now + seconds * 1000);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === new Date(now).toDateString()) return `at ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `on ${at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

/** A kind, specific message for a failed POST. */
export function reviewErrorFor(
  status: number,
  body: ReviewErrorBody | null,
  retryAfterSeconds: number,
  now = Date.now(),
): ReviewError {
  switch (body?.code) {
    case "refused":
      return {
        message:
          "Claude declined to review this document. That can happen with some topics, and it is not a judgement of your writing. Your suggestions and the Overview still work.",
      };
    case "rate_limited":
      return {
        message: `${body.error || "Too many reviews for now."} You can ask for a review again ${retryWhen(retryAfterSeconds, now)}.`,
      };
    case "server_limit":
      return { message: body.error };
    case "ai_disabled":
      return { message: "AI is off, so Polaris will not send your document.", settings: true };
    case "ai_unavailable":
      return { message: "Reviews by Claude aren’t set up on this server." };
    case "too_short":
    case "too_long":
      return { message: body.error };
  }
  if (status === 401)
    return { message: "Your session has ended. Sign in again to ask for a review." };
  if (status === 404) return { message: "This document no longer exists." };
  return { message: FAILED };
}

/** "just now", "5 minutes ago", "yesterday", or a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
  return `on ${new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}

const SETTINGS_LINK = (
  <Link href="/settings" className="underline hover:text-foreground">
    Settings
  </Link>
);

/** Why the writer cannot ask for a review right now, or null if they can. */
function blockedReason(
  ai: ReviewAvailability | null,
  lookupFailed: boolean,
  words: number,
): ReactNode {
  if (!ai) {
    return lookupFailed
      ? "Polaris couldn’t check whether reviews are available. Reload the page to try again."
      : "Checking whether reviews are available…";
  }
  if (!ai.configured) return "Reviews by Claude aren’t set up on this server.";
  if (!ai.enabled) return <>AI is off. Turn it on in {SETTINGS_LINK} to ask for a review.</>;
  if (words < REVIEW_MIN_WORDS) {
    return `A review needs at least ${REVIEW_MIN_WORDS} words. This document has ${formatNumber(words)}.`;
  }
  if (words > REVIEW_MAX_WORDS) {
    return `A review can cover up to ${formatNumber(REVIEW_MAX_WORDS)} words. This document has ${formatNumber(words)}.`;
  }
  return null;
}

interface Props {
  documentId: string;
  /** Loaded (and refreshed) when the tab is shown. */
  active: boolean;
  ai: ReviewAvailability | null;
  /** Polaris could not find out `ai` (it asks again when the writer comes back to the tab). */
  aiLookupFailed?: boolean;
  /** Live word count and plain text, as the editor has them now. */
  words: number;
  text: string;
  /**
   * Which blocks are headings (blockLayout() in src/lib/editor/locate.ts). A review's paragraph
   * numbers skip headings, so turning a paragraph into one makes the review stale too.
   */
  layout: string;
  /**
   * Where the footnotes are and what they say (footnotesLayout() in src/lib/documents/blocks.ts):
   * a review reads them too, so editing one makes the review stale.
   */
  footnotes?: string;
  /** Saves any pending edits now; false if that failed. */
  flushSave: () => Promise<boolean>;
  /** Selects the passage in the editor; false if it is no longer there. */
  onFindQuote: (quote: string) => boolean;
  onFindParagraph: (n: number) => boolean;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

/** The document as the editor had it: what a shown review is known to describe. */
interface Snapshot {
  text: string;
  layout: string;
  footnotes: string;
}

export function ReviewPanel({
  documentId,
  active,
  ai,
  aiLookupFailed = false,
  words,
  text,
  layout,
  footnotes = "[]",
  flushSave,
  onFindQuote,
  onFindParagraph,
}: Props) {
  const [review, setReview] = useState<DocumentReviewDTO | null>(null);
  // The editor's document that the shown review is known to describe: edits after it make the
  // review stale even before the server hears of them.
  const [reviewed, setReviewed] = useState<Snapshot | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<ReviewError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const snapshotRef = useRef<Snapshot>({ text, layout, footnotes });
  snapshotRef.current = { text, layout, footnotes };
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;
  const runRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const focusAfterRun = useRef<"results" | "error" | "start" | null>(null);
  const focusCancel = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    setLoadState((s) => (s === "loaded" ? s : "loading"));
    // The server compares the review with the document as saved, so save first.
    const saved = await flushRef.current();
    const snapshot = snapshotRef.current;
    try {
      const res = await fetch(reviewEndpoint(documentId), { cache: "no-store" });
      if (!mounted.current || runRef.current) return;
      if (res.status === 404) {
        setReview(null);
        setReviewed(null);
      } else if (res.ok) {
        const { review: latest } = (await res.json()) as ReviewResponse;
        if (!mounted.current || runRef.current) return;
        setReview(latest);
        setReviewed(latest.stale || !saved ? null : snapshot);
      } else {
        throw new Error(`GET review: ${res.status}`);
      }
      setLoadState("loaded");
    } catch {
      if (mounted.current) setLoadState((s) => (s === "loaded" ? s : "error"));
    }
  }, [documentId]);

  // Each time the tab is shown: the document may have changed (or been reviewed elsewhere).
  useEffect(() => {
    if (active && !runRef.current) void load();
  }, [active, load]);

  // "Reviewed 5 minutes ago" keeps up while the panel is open.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);

  // The button that started the run gives way to Cancel (or is disabled) while it runs, so
  // focus goes to Cancel rather than being dropped.
  useEffect(() => {
    if (!running || !focusCancel.current) return;
    focusCancel.current = false;
    cancelRef.current?.focus();
  }, [running]);

  // When a run ends, focus goes somewhere useful instead of the vanished Cancel button.
  useEffect(() => {
    if (running || !focusAfterRun.current) return;
    const target = focusAfterRun.current;
    focusAfterRun.current = null;
    (target === "results" ? resultsRef : target === "error" ? errorRef : startRef).current?.focus();
  }, [running, review, error]);

  async function run() {
    if (runRef.current) return;
    const controller = new AbortController();
    runRef.current = controller;
    focusCancel.current = document.activeElement === startRef.current;
    setRunning(true);
    setError(null);
    setStatus("");
    let outcome: "results" | "error" | "start" = "error";
    try {
      const saved = await flushRef.current();
      if (controller.signal.aborted) {
        outcome = "start";
        return;
      }
      if (!saved) {
        setError({ message: SAVE_ERROR });
        return;
      }
      const snapshot = snapshotRef.current;
      const res = await fetch(reviewEndpoint(documentId), {
        method: "POST",
        signal: controller.signal,
      });
      if (res.ok) {
        const { review: created } = (await res.json()) as ReviewResponse;
        setReview(created);
        setReviewed(snapshot);
        setLoadState("loaded");
        setStatus("Review ready.");
        outcome = "results";
      } else {
        const body = (await res.json().catch(() => null)) as ReviewErrorBody | null;
        setError(reviewErrorFor(res.status, body, Number(res.headers.get("Retry-After"))));
      }
    } catch {
      if (controller.signal.aborted) outcome = "start";
      else setError({ message: NETWORK_ERROR });
    } finally {
      if (mounted.current) {
        const hadFocus = document.activeElement === cancelRef.current;
        focusAfterRun.current = hadFocus ? outcome : null;
        runRef.current = null;
        setRunning(false);
      }
    }
  }

  function cancel() {
    runRef.current?.abort();
    setStatus("Review cancelled.");
  }

  const blocked = blockedReason(ai, aiLookupFailed, words);
  const stale =
    !!review &&
    (review.stale ||
      (reviewed !== null &&
        (text !== reviewed.text ||
          layout !== reviewed.layout ||
          footnotes !== reviewed.footnotes)));

  return (
    <div className="flex-1 space-y-4 overflow-y-auto pb-6 text-sm" data-testid="review">
      {/* Always rendered, so a screen reader is listening before the first change. */}
      <div className="flex items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-muted" data-testid="review-status">
          {running ? REVIEW_RUNNING : status}
        </p>
        {running && (
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-border bg-surface p-3 outline-none"
          data-testid="review-error"
        >
          {error.message}
          {error.settings && <> Turn it on in {SETTINGS_LINK} to ask for a review.</>}
        </div>
      )}

      {!review && loadState === "loading" && <p className="text-muted">Loading the last review…</p>}
      {!review && loadState === "error" && (
        <p className="text-muted">
          Couldn’t load the last review.{" "}
          <button
            type="button"
            onClick={() => void load()}
            className="underline hover:text-foreground"
          >
            Try again
          </button>
        </p>
      )}

      {!review && loadState === "loaded" && !running && (
        <section aria-labelledby="review-intro" className="space-y-3">
          <h3 id="review-intro" className="font-semibold">
            Feedback on the whole document
          </h3>
          <p className="text-muted">
            Claude reads your draft as an instructor would and gives feedback on your thesis,
            structure, argument, evidence and style, with the few changes that would help most.
          </p>
          <p className="text-muted">
            {REVIEW_SENDS} when you ask for a review, and saves the review with this document.
            Nothing is sent until you do.
          </p>
          <ReviewButton
            ref={startRef}
            label="Review document"
            blocked={blocked}
            busy={running}
            reasonId="review-reason-start"
            onClick={() => void run()}
          />
        </section>
      )}

      {review && (
        <Results
          key={review.id}
          review={review}
          now={now}
          stale={stale}
          headingRef={resultsRef}
          onFindQuote={onFindQuote}
          onFindParagraph={onFindParagraph}
          again={
            <ReviewButton
              ref={startRef}
              label="Review again"
              blocked={blocked}
              busy={running}
              reasonId="review-reason-again"
              onClick={() => void run()}
            />
          }
        />
      )}
    </div>
  );
}

function ReviewButton({
  ref,
  label,
  blocked,
  busy,
  reasonId,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>;
  label: string;
  blocked: ReactNode;
  busy: boolean;
  reasonId: string;
  onClick: () => void;
}) {
  return (
    <div>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={!!blocked || busy}
        aria-describedby={blocked ? reasonId : undefined}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:text-black"
      >
        {label}
      </button>
      {blocked && (
        <p id={reasonId} className="mt-2 text-xs text-muted" data-testid="review-blocked">
          {blocked}
        </p>
      )}
    </div>
  );
}

const shorten = (s: string, max = 120) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/**
 * Says next to a find button that its target has gone. Always rendered, as a live region, so the
 * change is announced (focus stays on the button), and it describes the button from then on.
 */
function MissingNote({
  id,
  missing,
  children,
}: {
  id: string;
  missing: boolean;
  children: string;
}) {
  return (
    <span id={id} aria-live="polite" className="text-xs text-muted">
      {missing ? ` (${children})` : ""}
    </span>
  );
}

/** A quoted passage; selecting it finds the passage in the text as it is now. */
function QuoteButton({ quote, onFind }: { quote: string; onFind: (quote: string) => boolean }) {
  const [missing, setMissing] = useState(false);
  const noteId = useId();
  return (
    <span className="mt-1 block">
      <button
        type="button"
        onClick={() => setMissing(!onFind(quote))}
        title="Show this passage in your text"
        aria-describedby={missing ? noteId : undefined}
        className="text-left italic text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        data-testid="review-quote"
      >
        <span className="sr-only">Show in text: </span>“{shorten(quote)}”
      </button>
      <MissingNote id={noteId} missing={missing}>
        this passage has changed
      </MissingNote>
    </span>
  );
}

function ParagraphButton({ n, onFind }: { n: number; onFind: (n: number) => boolean }) {
  const [missing, setMissing] = useState(false);
  const noteId = useId();
  return (
    <span>
      <button
        type="button"
        onClick={() => setMissing(!onFind(n))}
        className="rounded border border-border px-1.5 text-xs tabular-nums hover:border-accent hover:text-accent"
        aria-label={`Go to paragraph ${n}`}
        aria-describedby={missing ? noteId : undefined}
      >
        ¶ {n}
      </button>
      <MissingNote id={noteId} missing={missing}>
        this paragraph has changed
      </MissingNote>
    </span>
  );
}

function Results({
  review,
  now,
  stale,
  headingRef,
  onFindQuote,
  onFindParagraph,
  again,
}: {
  review: DocumentReviewDTO;
  now: number;
  stale: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onFindQuote: (quote: string) => boolean;
  onFindParagraph: (n: number) => boolean;
  again: ReactNode;
}) {
  const r = review.result;
  const aspects: [string, string][] = [
    ["Structure", r.structure],
    ["Argument", r.argument],
    ["Evidence", r.evidence],
    ["Style", r.style],
  ];
  return (
    <article aria-labelledby="review-heading" className="space-y-5" data-testid="review-results">
      <header>
        <h3
          id="review-heading"
          ref={headingRef}
          tabIndex={-1}
          className="font-semibold outline-none"
        >
          Reviewed {relativeTime(review.createdAt, now)} · {formatNumber(review.wordCount)}{" "}
          {review.wordCount === 1 ? "word" : "words"}
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          Feedback from Claude ({review.model}). Weigh it against your own judgement and your
          instructor’s guidance.
        </p>
      </header>

      {stale && (
        <div
          className="space-y-2 rounded-md border border-accent bg-accent-soft p-3"
          data-testid="review-stale"
        >
          <p>{REVIEW_STALE}</p>
          {again}
        </div>
      )}

      <p>{r.summary}</p>

      {r.thesis.assessment && (
        <section aria-labelledby="review-thesis">
          <h4 id="review-thesis" className="font-semibold">
            Thesis
          </h4>
          <p className="mt-1">{r.thesis.assessment}</p>
          {r.thesis.quote && <QuoteButton quote={r.thesis.quote} onFind={onFindQuote} />}
        </section>
      )}

      {r.priorities.length > 0 && (
        <section aria-labelledby="review-priorities">
          <h4 id="review-priorities" className="font-semibold">
            Top priorities
          </h4>
          <ol className="mt-2 space-y-3" data-testid="review-priorities">
            {r.priorities.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="font-semibold tabular-nums text-muted">
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  {/* The category in words, so colour is never the only signal. */}
                  <span className="text-xs uppercase tracking-wide text-muted">
                    {REVIEW_CATEGORY_LABELS[p.category]}
                  </span>
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-0.5 text-muted">{p.detail}</p>
                  {p.quote && <QuoteButton quote={p.quote} onFind={onFindQuote} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {r.strengths.length > 0 && (
        <section aria-labelledby="review-strengths">
          <h4 id="review-strengths" className="font-semibold">
            Strengths
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {r.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {r.sections.length > 0 && (
        <section aria-labelledby="review-sections">
          <h4 id="review-sections" className="font-semibold">
            Section by section
          </h4>
          <ul className="mt-2 space-y-2">
            {r.sections.map((s, i) => (
              <li key={i}>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {s.paragraph !== null && (
                    <ParagraphButton n={s.paragraph} onFind={onFindParagraph} />
                  )}
                  {s.heading && <span className="font-medium">{s.heading}</span>}
                </span>
                <p className="mt-0.5 text-muted">{s.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {aspects
        .filter(([, body]) => body)
        .map(([title, body]) => (
          <section key={title} aria-label={title}>
            <h4 className="font-semibold">{title}</h4>
            <p className="mt-1 text-muted">{body}</p>
          </section>
        ))}

      {/* Without edits too: new goals or a new title deserve a new review. */}
      {!stale && (
        <footer className="space-y-2 border-t border-border pt-4" data-testid="review-again">
          <p className="text-muted">
            Changed your writing goals or the title? A new review takes them into account.
          </p>
          {again}
        </footer>
      )}
    </article>
  );
}
