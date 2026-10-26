import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createParagraphChecker } from "@/lib/rules/engine";
import { expandDeletion } from "@/lib/rules/apply";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { RuleContext, RuleMatch } from "@/lib/rules/types";
import {
  collectTextBlocks,
  OBJECT_REPLACEMENT,
  withoutFootnotes,
  type TextBlock,
} from "./textblocks";

export interface Suggestion extends RuleMatch {
  /**
   * Stable across unrelated edits: rule + paragraph text (and which of several identical
   * paragraphs) + offset.
   */
  key: string;
  /** The rule engine, or Claude (ruleId "ai"). */
  source: "rules" | "ai";
  from: number;
  to: number;
  /** The paragraph's text, used to widen deletions. */
  blockText: string;
  blockFrom: number;
  /** The flagged words as the writer reads them: no footnote markers, a line break as a space. */
  flagged: string;
}

/**
 * Matches computed elsewhere (Claude), keyed by the paragraph text they were computed for: the
 * text without its footnote markers (withoutFootnotes() in ./textblocks), as it was sent.
 */
export type ExternalMatches = Map<string, RuleMatch[]>;

/**
 * A suggestion the writer dismissed: that rule, at that place in the document. The range is
 * mapped through every edit, so the dismissal follows its words wherever the text around them
 * changes, and the same words flagged somewhere else still show.
 */
interface Dismissal {
  ruleId: string;
  from: number;
  to: number;
}

interface PluginState {
  suggestions: Suggestion[];
  decorations: DecorationSet;
  dismissed: Dismissal[];
  activeKey: string | null;
  external: ExternalMatches;
}

type Meta =
  | { type: "dismiss"; key: string }
  | { type: "activate"; key: string | null }
  | { type: "recheck" }
  | { type: "external"; matches: ExternalMatches };

export const suggestionsKey = new PluginKey<PluginState>("polaris-suggestions");

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Adds external matches to a paragraph's rule matches. Rules win: an external match that
 * overlaps a rule's underline (or an earlier external match) is dropped. Long-sentence spans
 * do not count, as they cover whole sentences and are drawn differently, like in the engine.
 */
export function mergeMatches(text: string, rules: RuleMatch[], external: RuleMatch[]): RuleMatch[] {
  if (external.length === 0) return rules;
  const taken = rules.filter((m) => m.ruleId !== "long-sentence");
  const merged = [...rules];
  for (const match of external) {
    if (match.start < 0 || match.end > text.length || match.end <= match.start) continue;
    if (taken.some((t) => match.start < t.end && t.start < match.end)) continue;
    taken.push(match);
    merged.push(match);
  }
  return merged.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Moves matches computed on a block's footnote-free text (withoutFootnotes()) to the block's
 * own text, where each footnote marker is a character. A match that would take in a marker is
 * dropped if it can be applied (applying it would delete the footnote along with the text); one
 * that only marks a stretch of text (a long sentence, a suggestion to rephrase) is kept.
 */
function toBlockMatches(
  block: TextBlock,
  prose: ReturnType<typeof withoutFootnotes>,
  matches: RuleMatch[],
): RuleMatch[] {
  if (block.footnotes.length === 0) return matches;
  const out: RuleMatch[] = [];
  for (const m of matches) {
    if (m.start < 0 || m.end > prose.text.length || m.end <= m.start) continue;
    const start = prose.toBlock(m.start, "start");
    const end = prose.toBlock(m.end, "end");
    const spansMarker = block.footnotes.some((f) => f >= start && f < end);
    if (spansMarker && m.replacements.length > 0) continue;
    out.push({ ...m, start, end });
  }
  return out;
}

/** A block's external matches (Claude's), computed on the text it was sent: without markers. */
export function externalMatchesFor(block: TextBlock, external: ExternalMatches): RuleMatch[] {
  const prose = withoutFootnotes(block);
  const matches = external.get(prose.text);
  if (!matches?.length) return [];
  return toBlockMatches(block, prose, matches);
}

/**
 * A block's rule matches. The rules read the writer's prose, without footnote markers (as
 * Claude does), so "argued.¹ The next" still ends a sentence after the full stop.
 */
export function ruleMatchesFor(
  block: TextBlock,
  check: (text: string) => RuleMatch[],
): RuleMatch[] {
  const prose = withoutFootnotes(block);
  return toBlockMatches(block, prose, check(prose.text));
}

/** Code blocks hold code, not prose: no rule or AI suggestion is made in them. */
export const CODE_BLOCK_NODE = "codeBlock";
const CODE_MARK = "code";

/** Where a block's inline code is, as [start, end) offsets in its text (one per inline atom). */
function codeRanges(node: PMNode): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  node.forEach((child) => {
    const length = child.isText ? (child.text ?? "").length : 1;
    if (child.isText && child.marks.some((m) => m.type.name === CODE_MARK)) {
      const last = ranges.at(-1);
      if (last && last[1] === offset) last[1] = offset + length;
      else ranges.push([offset, offset + length]);
    }
    offset += length;
  });
  return ranges;
}

/** The flagged words as the writer reads them (see Suggestion.flagged). */
function readable(block: TextBlock, start: number, end: number): string {
  const text = block.text.slice(start, end);
  if (!text.includes(OBJECT_REPLACEMENT)) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== OBJECT_REPLACEMENT) out += text[i];
    else if (!block.footnotes.includes(start + i)) out += " ";
  }
  return out;
}

function computeSuggestions(
  state: EditorState | { doc: EditorState["doc"] },
  check: (text: string) => RuleMatch[],
  external: ExternalMatches,
  dismissed: Dismissal[],
): Suggestion[] {
  const out: Suggestion[] = [];
  const dismissedAt = new Set(dismissed.map((d) => `${d.ruleId}:${d.from}-${d.to}`));
  // How many paragraphs with the same text came before, so identical ones get different keys.
  const copies = new Map<string, number>();
  for (const block of collectTextBlocks(state.doc)) {
    if (!block.text.trim()) continue;
    const node = state.doc.nodeAt(block.pos);
    if (!node || node.type.name === CODE_BLOCK_NODE) continue;
    const blockHash = hash(block.text);
    const copy = copies.get(blockHash) ?? 0;
    copies.set(blockHash, copy + 1);
    const code = codeRanges(node);
    // Dismissed matches go before merging: one the writer rejected shows nothing, so it must
    // not hide an overlapping match either. So do matches in inline code (`like this`), except
    // a long sentence's span, which is about the whole sentence.
    const visible = (m: RuleMatch) =>
      !dismissedAt.has(`${m.ruleId}:${block.posAt(m.start)}-${block.posAt(m.end)}`) &&
      (m.ruleId === "long-sentence" || !code.some(([s, e]) => m.start < e && s < m.end));
    // Keyed by text, so a result only ever shows on the exact text it was computed for.
    const matches = mergeMatches(
      block.text,
      ruleMatchesFor(block, check).filter(visible),
      externalMatchesFor(block, external).filter(visible),
    );
    const blockKey = copy === 0 ? blockHash : `${blockHash}#${copy}`;
    for (const match of matches) {
      out.push({
        ...match,
        key: `${match.ruleId}:${blockKey}:${match.start}-${match.end}`,
        source: match.ruleId === "ai" ? "ai" : "rules",
        from: block.posAt(match.start),
        to: block.posAt(match.end),
        blockText: block.text,
        blockFrom: block.posAt(0),
        flagged: readable(block, match.start, match.end),
      });
    }
  }
  return out;
}

/** Moves dismissals with the edit; one whose words were deleted is forgotten. */
function mapDismissals(dismissed: Dismissal[], tr: Transaction): Dismissal[] {
  if (!tr.docChanged || dismissed.length === 0) return dismissed;
  const out: Dismissal[] = [];
  for (const d of dismissed) {
    // Text typed right before or right after the words is not part of them.
    const from = tr.mapping.map(d.from, 1);
    const to = tr.mapping.map(d.to, -1);
    if (to > from) out.push({ ...d, from, to });
  }
  return out;
}

function buildDecorations(
  doc: EditorState["doc"],
  suggestions: Suggestion[],
  activeKey: string | null,
): DecorationSet {
  return DecorationSet.create(
    doc,
    suggestions.map((s) =>
      Decoration.inline(
        s.from,
        s.to,
        {
          class: [
            "polaris-suggestion",
            `polaris-suggestion--${s.category}`,
            s.ruleId === "long-sentence" ? "polaris-suggestion--span" : "",
            s.source === "ai" ? "polaris-suggestion--ai" : "",
            s.key === activeKey ? "polaris-suggestion--active" : "",
          ]
            .filter(Boolean)
            .join(" "),
          "data-suggestion-key": s.key,
        },
        { key: s.key },
      ),
    ),
  );
}

export interface SuggestionsOptions {
  getContext: () => RuleContext;
  onChange?: (suggestions: Suggestion[], activeKey: string | null) => void;
}

export const Suggestions = Extension.create<SuggestionsOptions>({
  name: "suggestions",

  addOptions() {
    return { getContext: () => ({}), onChange: undefined };
  },

  addProseMirrorPlugins() {
    const check = createParagraphChecker(this.options.getContext);
    const onChange = this.options.onChange;

    return [
      new Plugin<PluginState>({
        key: suggestionsKey,
        state: {
          init(_config, state) {
            const dismissed: Dismissal[] = [];
            const external: ExternalMatches = new Map();
            const suggestions = computeSuggestions(state, check, external, dismissed);
            return {
              suggestions,
              dismissed,
              activeKey: null,
              external,
              decorations: buildDecorations(state.doc, suggestions, null),
            };
          },
          apply(tr: Transaction, prev, _old, state) {
            const meta = tr.getMeta(suggestionsKey) as Meta | undefined;
            let { dismissed, activeKey, external } = prev;
            if (meta?.type === "dismiss") {
              const target = prev.suggestions.find((s) => s.key === meta.key);
              if (target) {
                dismissed = [
                  ...dismissed,
                  { ruleId: target.ruleId, from: target.from, to: target.to },
                ];
              }
              if (activeKey === meta.key) activeKey = null;
            } else if (meta?.type === "activate") {
              activeKey = meta.key;
            } else if (meta?.type === "external") {
              external = meta.matches;
            }
            if (!tr.docChanged && !meta) return prev;
            dismissed = mapDismissals(dismissed, tr);

            const suggestions =
              tr.docChanged || meta?.type !== "activate"
                ? computeSuggestions(state, check, external, dismissed)
                : prev.suggestions;
            if (activeKey && !suggestions.some((s) => s.key === activeKey)) activeKey = null;
            return {
              suggestions,
              dismissed,
              activeKey,
              external,
              decorations: buildDecorations(state.doc, suggestions, activeKey),
            };
          },
        },
        props: {
          decorations: (state) => suggestionsKey.getState(state)?.decorations,
          handleClick(view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.("[data-suggestion-key]");
            const key = el?.getAttribute("data-suggestion-key") ?? null;
            const current = suggestionsKey.getState(view.state)?.activeKey ?? null;
            if (key !== current) {
              view.dispatch(view.state.tr.setMeta(suggestionsKey, { type: "activate", key }));
            }
            return false;
          },
        },
        view(view) {
          let last: PluginState | undefined;
          const notify = () => {
            const s = suggestionsKey.getState(view.state);
            if (s && s !== last) {
              last = s;
              onChange?.(s.suggestions, s.activeKey);
            }
          };
          notify();
          return { update: notify };
        },
      }),
    ];
  },
});

/** Commands as plain functions so the React layer does not need to know about plugin meta. */
export function applySuggestion(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  suggestion: Suggestion,
  replacement: string,
) {
  const current = suggestionsKey
    .getState(view.state)
    ?.suggestions.find((s) => s.key === suggestion.key);
  if (!current) return false;
  let { from, to } = current;
  if (replacement === "") {
    const offset = (p: number) => p - current.blockFrom;
    const [start, end] = expandDeletion(current.blockText, offset(from), offset(to));
    from = current.blockFrom + start;
    to = current.blockFrom + end;
    view.dispatch(view.state.tr.delete(from, to));
  } else {
    view.dispatch(view.state.tr.insertText(replacement, from, to));
  }
  return true;
}

export function dismissSuggestion(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  key: string,
) {
  view.dispatch(view.state.tr.setMeta(suggestionsKey, { type: "dismiss", key }));
}

export function activateSuggestion(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  key: string | null,
) {
  view.dispatch(view.state.tr.setMeta(suggestionsKey, { type: "activate", key }));
}

/**
 * Shows matches computed outside the rule engine (Claude's), keyed by the paragraph text they
 * were computed for: a paragraph whose text differs shows none of them. Replaces the
 * previous set. Not an edit, so it stays out of the undo history.
 */
export function setExternalMatches(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  matches: ExternalMatches,
) {
  view.dispatch(
    view.state.tr
      .setMeta(suggestionsKey, { type: "external", matches } satisfies Meta)
      .setMeta("addToHistory", false),
  );
}

/** Re-run all rules, e.g. after the writing goals (citation style) change. */
export function recheckSuggestions(view: {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}) {
  view.dispatch(view.state.tr.setMeta(suggestionsKey, { type: "recheck" }));
}
