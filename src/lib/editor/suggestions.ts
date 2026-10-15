import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createParagraphChecker } from "@/lib/rules/engine";
import { expandDeletion } from "@/lib/rules/apply";
import type { RuleContext, RuleMatch } from "@/lib/rules/types";
import { collectTextBlocks } from "./textblocks";

export interface Suggestion extends RuleMatch {
  /** Stable across unrelated edits: rule + paragraph text + offset. */
  key: string;
  from: number;
  to: number;
  /** The paragraph's text, used to widen deletions. */
  blockText: string;
  blockFrom: number;
}

interface PluginState {
  suggestions: Suggestion[];
  decorations: DecorationSet;
  dismissed: Set<string>;
  activeKey: string | null;
}

type Meta =
  | { type: "dismiss"; key: string }
  | { type: "activate"; key: string | null }
  | { type: "recheck" };

export const suggestionsKey = new PluginKey<PluginState>("polaris-suggestions");

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function computeSuggestions(
  state: EditorState | { doc: EditorState["doc"] },
  check: (text: string) => RuleMatch[],
  dismissed: Set<string>,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const block of collectTextBlocks(state.doc)) {
    if (!block.text.trim()) continue;
    const blockHash = hash(block.text);
    for (const match of check(block.text)) {
      const key = `${match.ruleId}:${blockHash}:${match.start}-${match.end}`;
      if (dismissed.has(dismissKey(match, block.text))) continue;
      out.push({
        ...match,
        key,
        from: block.posAt(match.start),
        to: block.posAt(match.end),
        blockText: block.text,
        blockFrom: block.posAt(0),
      });
    }
  }
  return out;
}

/** Dismissals key on the flagged text itself, so they survive edits elsewhere in the paragraph. */
function dismissKey(match: RuleMatch, blockText: string): string {
  return `${match.ruleId}:${blockText.slice(match.start, match.end).toLowerCase()}`;
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
            const dismissed = new Set<string>();
            const suggestions = computeSuggestions(state, check, dismissed);
            return {
              suggestions,
              dismissed,
              activeKey: null,
              decorations: buildDecorations(state.doc, suggestions, null),
            };
          },
          apply(tr: Transaction, prev, _old, state) {
            const meta = tr.getMeta(suggestionsKey) as Meta | undefined;
            let { dismissed, activeKey } = prev;
            if (meta?.type === "dismiss") {
              const target = prev.suggestions.find((s) => s.key === meta.key);
              if (target) {
                dismissed = new Set(dismissed);
                dismissed.add(dismissKey(target, target.blockText));
              }
              if (activeKey === meta.key) activeKey = null;
            } else if (meta?.type === "activate") {
              activeKey = meta.key;
            }
            if (!tr.docChanged && !meta) return prev;

            const suggestions =
              tr.docChanged || meta?.type !== "activate"
                ? computeSuggestions(state, check, dismissed)
                : prev.suggestions;
            if (activeKey && !suggestions.some((s) => s.key === activeKey)) activeKey = null;
            return {
              suggestions,
              dismissed,
              activeKey,
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

/** Re-run all rules, e.g. after the writing goals (citation style) change. */
export function recheckSuggestions(view: {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}) {
  view.dispatch(view.state.tr.setMeta(suggestionsKey, { type: "recheck" }));
}
