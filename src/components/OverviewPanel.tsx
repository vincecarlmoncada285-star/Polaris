"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Suggestion } from "@/lib/editor/suggestions";
import { CATEGORIES, type Category } from "@/lib/rules/types";
import {
  computeMetrics,
  MATTR_WINDOW,
  OPENER_MIN_COUNT,
  type MetricsBlock,
  type SentenceLocation,
  type WritingMetrics,
} from "@/lib/text/metrics";
import { formatNumber } from "@/lib/text/format";

/** Metrics wait this long after the last keystroke, so typing never waits for them. */
export const METRICS_IDLE_MS = 300;
/** Below this, readability formulas say more about chance than about the writing. */
export const READABILITY_MIN_WORDS = 100;

const CATEGORY_COLOR: Record<Category, string> = {
  correctness: "var(--cat-correctness)",
  clarity: "var(--cat-clarity)",
  concision: "var(--cat-concision)",
  formality: "var(--cat-formality)",
  citations: "var(--cat-citations)",
};

const fmt = formatNumber;
const wordsText = (n: number) => `${fmt(n)} ${n === 1 ? "word" : "words"}`;

/** Flesch's own bands for Reading Ease. */
function easeBand(score: number): string {
  if (score >= 90) return "very easy";
  if (score >= 80) return "easy";
  if (score >= 70) return "fairly easy";
  if (score >= 60) return "plain English";
  if (score >= 50) return "fairly difficult";
  if (score >= 30) return "difficult";
  return "very difficult";
}

/** "1,240 of 2,000 words (62%)": the visible text and the progressbar's value text. */
export function targetProgressText(words: number, target: number): string {
  return `${fmt(words)} of ${fmt(target)} words (${Math.round((words / target) * 100)}%)`;
}

interface Props {
  /** Only the visible panel computes. */
  active: boolean;
  /**
   * The document's plain text, and which of its blocks are headings (blockLayout() in
   * src/lib/editor/locate.ts): when either changes, metrics are recomputed once typing stops.
   * The layout matters on its own: making a paragraph a heading leaves the text as it was.
   */
  text: string;
  layout: string;
  /** Live word count, as in the footer. */
  words: number;
  getBlocks: () => MetricsBlock[];
  suggestions: Suggestion[];
  targetWords?: number;
  onSelectSentence: (sentence: SentenceLocation) => boolean;
  onEditGoals: () => void;
}

export function OverviewPanel({
  active,
  text,
  layout,
  words,
  getBlocks,
  suggestions,
  targetWords,
  onSelectSentence,
  onEditGoals,
}: Props) {
  const [metrics, setMetrics] = useState<WritingMetrics | null>(null);
  const [longestMissing, setLongestMissing] = useState(false);
  const computedFor = useRef<{ text: string; layout: string } | null>(null);
  const wasActive = useRef(false);
  const getBlocksRef = useRef(getBlocks);
  getBlocksRef.current = getBlocks;

  useEffect(() => {
    const justShown = active && !wasActive.current;
    wasActive.current = active;
    const done = computedFor.current;
    if (!active || (done?.text === text && done.layout === layout)) return;
    const compute = () => {
      computedFor.current = { text, layout };
      setMetrics(computeMetrics(getBlocksRef.current()));
      setLongestMissing(false);
    };
    // When the panel is shown, straight away; while it is open, once typing pauses.
    if (justShown) {
      compute();
      return;
    }
    const timer = setTimeout(compute, METRICS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [active, text, layout]);

  return (
    <div className="flex-1 space-y-6 overflow-y-auto pb-6 text-sm" data-testid="overview">
      <TargetProgress words={words} target={targetWords} onEditGoals={onEditGoals} />
      {metrics && (
        <>
          <WritingSection
            metrics={metrics}
            longestMissing={longestMissing}
            onSelectLongest={() => {
              if (metrics.longestSentence && !onSelectSentence(metrics.longestSentence)) {
                setLongestMissing(true);
              }
            }}
          />
          <SuggestionCounts suggestions={suggestions} words={words} />
        </>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>
  );
}

function TargetProgress({
  words,
  target,
  onEditGoals,
}: {
  words: number;
  target?: number;
  onEditGoals: () => void;
}) {
  if (!target) {
    return (
      <section aria-labelledby="overview-length">
        <SectionHeading>
          <span id="overview-length">Length</span>
        </SectionHeading>
        <p className="text-muted">
          No target length set.{" "}
          <button type="button" onClick={onEditGoals} className="underline hover:text-foreground">
            Set one in Goals
          </button>
        </p>
      </section>
    );
  }
  const label = targetProgressText(words, target);
  const over = words - target;
  return (
    <section aria-labelledby="overview-length">
      <SectionHeading>
        <span id="overview-length">Target length</span>
      </SectionHeading>
      <p data-testid="target-progress-text">{label}</p>
      {/* aria-valuenow may not pass the maximum, so the value text carries the real figure. */}
      <div
        role="progressbar"
        aria-labelledby="overview-length"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(words, target)}
        aria-valuetext={label}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, (words / target) * 100)}%` }}
        />
      </div>
      {over > 0 && (
        <p className="mt-1 text-xs text-muted">
          {fmt(over)} {over === 1 ? "word" : "words"} over the target.
        </p>
      )}
    </section>
  );
}

/** One term and its value, with an optional hint under both: dt and dd stay direct children. */
function Row({
  label,
  value,
  hint,
  hintId,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  testId?: string;
}) {
  return (
    <div
      className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 py-2"
      data-testid={testId}
    >
      <dt className="font-medium">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
      {hint && (
        <dd id={hintId} className="col-span-2 mt-0.5 text-xs text-muted">
          {hint}
        </dd>
      )}
    </div>
  );
}

function WritingSection({
  metrics: m,
  longestMissing,
  onSelectLongest,
}: {
  metrics: WritingMetrics;
  longestMissing: boolean;
  onSelectLongest: () => void;
}) {
  if (m.words === 0) {
    return <p className="text-muted">Start writing to see an overview of your document.</p>;
  }
  const enoughForReadability = m.proseWords >= READABILITY_MIN_WORDS;
  const variety = m.lexicalVariety;
  return (
    <section aria-labelledby="overview-writing">
      <SectionHeading>
        <span id="overview-writing">Your writing</span>
      </SectionHeading>
      <dl className="divide-y divide-border">
        <Row label="Words" value={fmt(m.words)} testId="metric-words" />
        <Row label="Sentences" value={fmt(m.sentences)} testId="metric-sentences" />
        <Row label="Paragraphs" value={fmt(m.paragraphs)} hint="Headings are not counted." />
        <Row
          label="Reading time"
          value={`about ${m.readingMinutes} min`}
          hint="At 200 words a minute, a typical pace for academic prose."
        />
        <Row
          label="Average sentence"
          value={
            m.averageSentenceLength === null ? "—" : `${fmt(m.averageSentenceLength, 1)} words`
          }
          hint="Academic prose often averages 20 to 25 words. Much longer averages make an argument harder to follow."
          testId="metric-average-sentence"
        />
        <Row
          label="Sentence variety"
          value={
            m.sentenceLengthSpread === null ? "—" : `± ${fmt(m.sentenceLengthSpread, 1)} words`
          }
          hint="How much sentence length varies (the standard deviation). A mix of short and long sentences is easier to read than a run of the same length."
        />
        <Row
          label="Longest sentence"
          testId="metric-longest"
          value={
            m.longestSentence ? (
              <button
                type="button"
                onClick={onSelectLongest}
                className="underline hover:text-accent"
                // The visible "13 words" alone would not say what the button is for.
                aria-label={`Longest sentence, ${wordsText(m.longestSentence.words)}`}
                aria-describedby="longest-hint"
              >
                {wordsText(m.longestSentence.words)}
              </button>
            ) : (
              "—"
            )
          }
          hintId="longest-hint"
          hint={
            <>
              {!longestMissing && "Select it to find it in your text."}
              {/* Focus stays on the button, so the outcome is announced. */}
              <span aria-live="polite">
                {longestMissing ? "That sentence has changed since this was measured." : ""}
              </span>
            </>
          }
        />
        <Row
          label="Reading ease"
          value={
            enoughForReadability && m.fleschReadingEase !== null
              ? `${fmt(m.fleschReadingEase)} · ${easeBand(m.fleschReadingEase)}`
              : "—"
          }
          hint={
            enoughForReadability
              ? "Flesch Reading Ease, from 0 (hardest) to about 100 (easiest). Readability scores are rough estimates made for general prose. Academic writing usually scores as difficult, and that is normal."
              : `Readability scores need at least ${READABILITY_MIN_WORDS} words of sentences to mean anything.`
          }
          testId="metric-reading-ease"
        />
        <Row
          label="Grade level"
          value={
            enoughForReadability && m.fleschKincaidGrade !== null
              ? fmt(Math.max(0, m.fleschKincaidGrade), 1)
              : "—"
          }
          hint="Flesch–Kincaid: roughly the US school grade a reader needs (13 and up is university level). Like reading ease, it counts only word and sentence length, not ideas."
        />
        <Row
          label="Passive voice"
          value={m.passiveShare === null ? "—" : `${fmt(m.passiveShare * 100)}% of sentences`}
          hint="Often fine in methods sections. Elsewhere, naming who did what is usually clearer."
        />
        <Row
          label="Word variety"
          value={variety ? fmt(variety.value, 2) : "—"}
          hint={
            variety?.method === "ttr"
              ? `The share of different words (under ${MATTR_WINDOW} words, so not yet averaged).`
              : `The share of different words in every ${MATTR_WINDOW}-word stretch, averaged (MATTR), from 0 to 1. Repeating key terms is normal in academic writing; a low figure can point to repeated filler.`
          }
        />
        <Row
          label="Repeated openers"
          value={
            m.repeatedOpeners.length
              ? m.repeatedOpeners.map((o) => `“${o.word}” (${o.count})`).join(", ")
              : "None"
          }
          hint={`First words that open ${OPENER_MIN_COUNT} or more sentences, with how many. Starting many sentences the same way can make prose feel repetitive.`}
          testId="metric-openers"
        />
      </dl>
    </section>
  );
}

function SuggestionCounts({ suggestions, words }: { suggestions: Suggestion[]; words: number }) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
  for (const s of suggestions) counts[s.category]++;
  const max = Math.max(1, ...Object.values(counts));
  return (
    <section aria-labelledby="overview-suggestions">
      <SectionHeading>
        <span id="overview-suggestions">Suggestions</span>
      </SectionHeading>
      <ul className="space-y-2" data-testid="suggestion-counts">
        {CATEGORIES.map((c) => {
          const count = counts[c.id];
          const rate = words > 0 ? (count / words) * 1000 : null;
          return (
            <li key={c.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span>{c.label}</span>
                <span className="tabular-nums">
                  {count}
                  <span className="text-muted">
                    {" · "}
                    {rate === null ? "—" : fmt(rate, 1)} per 1,000 words
                  </span>
                </span>
              </div>
              {/* Decorative: the numbers carry the meaning. */}
              <div aria-hidden className="mt-1 h-1.5 rounded-full bg-border">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(count / max) * 100}%`, background: CATEGORY_COLOR[c.id] }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Counts what is underlined now, AI suggestions included, minus what you dismissed.
      </p>
    </section>
  );
}
