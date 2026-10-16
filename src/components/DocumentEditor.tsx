"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paragraphGoals } from "@/lib/ai/protocol";
import { createAutosaver, registerPendingSave, type SaveStatus } from "@/lib/autosave";
import { blocksLayout, reviewBlocks } from "@/lib/documents/blocks";
import type { DocumentDTO } from "@/lib/documents/service";
import type { UpdateDocumentInput, WritingGoals } from "@/lib/documents/schema";
import { createAiScheduler, type AiScheduler, type AiStatus } from "@/lib/editor/ai-scheduler";
import {
  Suggestions,
  activateSuggestion,
  applySuggestion,
  dismissSuggestion,
  recheckSuggestions,
  setExternalMatches,
  type Suggestion,
} from "@/lib/editor/suggestions";
import {
  blockLayout,
  findParagraph,
  findSentence,
  findTextInDoc,
  metricsBlocks,
  type DocRange,
} from "@/lib/editor/locate";
import { collectTextBlocks } from "@/lib/editor/textblocks";
import { countCharacters, countWords, readingMinutes } from "@/lib/text/stats";
import { GoalsDialog } from "./GoalsDialog";
import { OverviewPanel } from "./OverviewPanel";
import { PanelTabs, useRememberedTab } from "./PanelTabs";
import { ReviewPanel } from "./ReviewPanel";
import { SuggestionPanel, type AiPanelState } from "./SuggestionPanel";
import { Toolbar } from "./Toolbar";
import { formatNumber } from "@/lib/text/format";

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved changes",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Couldn’t save. Retrying when you next edit.",
};

const BLOCK_SEPARATOR = "\n\n";

/** Whether this writer gets AI suggestions here: their setting, and whether the server can. */
interface AiAvailability {
  enabled: boolean;
  configured: boolean;
}

const paragraphTexts = (editor: Editor) => collectTextBlocks(editor.state.doc).map((b) => b.text);

const PANEL_TABS = ["suggestions", "overview", "review"] as const;
type PanelTabId = (typeof PANEL_TABS)[number];
/** localStorage key for the tab the writer last chose, in this browser. */
export const PANEL_TAB_KEY = "polaris:panel-tab";

export function DocumentEditor({ document: doc }: { document: DocumentDTO }) {
  const [title, setTitle] = useState(doc.title === "Untitled document" ? "" : doc.title);
  const [goals, setGoals] = useState<WritingGoals>(doc.goals);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [text, setText] = useState(doc.plainText);
  // Which blocks are headings: from the saved document until the editor has it, then from the
  // editor on every change. The same string either way, so a review loaded early is not stale.
  const [layout, setLayout] = useState(() => blocksLayout(reviewBlocks(doc)));
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [ai, setAi] = useState<AiAvailability | null>(null);
  const [aiLookupFailed, setAiLookupFailed] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ kind: "idle" });
  const [tab, setTab, showTab] = useRememberedTab<PanelTabId>(
    PANEL_TAB_KEY,
    PANEL_TABS,
    "suggestions",
  );
  const activeKeyRef = useRef<string | null>(null);

  // Rules read goals through a ref, so changing them does not rebuild the editor.
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const titleRef = useRef(title);
  titleRef.current = title;

  // Present only while AI suggestions are on and the server can provide them.
  const schedulerRef = useRef<AiScheduler | null>(null);
  const feedScheduler = useCallback((editor: Editor) => {
    schedulerRef.current?.update({
      paragraphs: paragraphTexts(editor),
      // Without the word target: it does not change what Claude says about a paragraph.
      goals: paragraphGoals(goalsRef.current),
      title: titleRef.current,
    });
  }, []);
  // The paragraphs as the document was opened (or as they stood when AI was switched back on).
  // Only text the writer then writes or changes is sent to Claude, as the Settings page says.
  const loadedParagraphs = useRef<string[] | null>(null);

  // Accumulate every field touched since the last save, so a title edit is not lost
  // behind a content edit that happens to be scheduled later.
  const pending = useRef<UpdateDocumentInput>({});
  const autosaver = useMemo(
    () =>
      createAutosaver<UpdateDocumentInput>(
        async (patch) => {
          // This save owns every field queued so far; later edits start a new patch.
          pending.current = {};
          const res = await fetch(`/api/documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
            keepalive: true,
          });
          if (!res.ok) {
            // Put the fields back so the next save retries them.
            pending.current = { ...patch, ...pending.current };
            throw new Error(`Save failed: ${res.status}`);
          }
        },
        { onStatus: setStatus },
      ),
    [doc.id],
  );

  const queueSave = useCallback(
    (patch: UpdateDocumentInput) => {
      pending.current = { ...pending.current, ...patch };
      autosaver.schedule(pending.current);
    },
    [autosaver],
  );

  /**
   * Saves everything now, for a review of the document as the writer sees it. A save that
   * failed earlier left its fields queued for the next edit: they are retried here. False if
   * the server still does not have the latest text.
   */
  const flushSave = useCallback(async () => {
    if (autosaver.status === "error" && Object.keys(pending.current).length > 0) {
      autosaver.schedule(pending.current);
    }
    await autosaver.flush();
    return autosaver.status !== "error";
  }, [autosaver]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // StarterKit 3 bundles Underline. Links stay off until there is UI to add and edit them.
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Placeholder.configure({ placeholder: "Start writing, or paste a draft…" }),
      Suggestions.configure({
        getContext: () => ({ citationStyle: goalsRef.current.citationStyle }),
        onChange: (next, active) => {
          setSuggestions(next);
          setActiveKey(active);
          // The writer just selected an underline in the text: its card is in the Suggestions
          // tab, so show that tab (without remembering it as their choice). Focus stays put.
          if (active !== null && active !== activeKeyRef.current) showTab("suggestions");
          activeKeyRef.current = active;
        },
      }),
    ],
    content: (doc.content as JSONContent | null) ?? undefined,
    onCreate: ({ editor }) => {
      loadedParagraphs.current ??= paragraphTexts(editor);
      setLayout(blockLayout(editor.state.doc));
    },
    editorProps: {
      attributes: {
        class: "polaris-prose",
        "aria-label": "Document body",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => {
      const plainText = editor.getText({ blockSeparator: BLOCK_SEPARATOR });
      setText(plainText);
      setLayout(blockLayout(editor.state.doc));
      queueSave({ content: editor.getJSON(), plainText });
      feedScheduler(editor);
    },
  });

  // The AI setting lives in the database and the key on the server, so ask when the editor
  // opens (and once more a little later if that fails), and again whenever the writer comes
  // back to the tab: they may have switched AI on or off in Settings in another one.
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (cancelled || loading) return;
      loading = true;
      attempts++;
      fetch("/api/me", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`GET /api/me: ${res.status}`);
          return res.json() as Promise<{ aiEnabled?: boolean; aiConfigured?: boolean } | null>;
        })
        .then((me) => {
          if (cancelled) return;
          const enabled = !!me?.aiEnabled;
          const configured = !!me?.aiConfigured;
          // A scheduler that stopped on a 403 or 503 stays stopped; build a new one if the
          // server now says AI works (switched off and on again elsewhere, say).
          const stopped = schedulerRef.current?.status.kind === "unavailable";
          // An unchanged answer keeps the same object, so the scheduler (its cache and its
          // requests in flight) carries on.
          setAi((prev) =>
            prev?.enabled === enabled &&
            prev.configured === configured &&
            !(stopped && enabled && configured)
              ? prev
              : { enabled, configured },
          );
          setAiLookupFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          setAiLookupFailed(true);
          if (attempts === 1) retry = setTimeout(load, 5000);
        })
        .finally(() => {
          loading = false;
        });
    };
    const onReturn = () => document.visibilityState === "visible" && load();
    load();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);

  // Paragraph text goes to the server only from here, and only when the writer turned AI on.
  useEffect(() => {
    if (!editor || !ai) return;
    if (!ai.enabled || !ai.configured) {
      // What the writer writes now, they write with AI off. If AI comes on later in this visit
      // (switched on in another tab), the document as it then stands counts as opened, as
      // after a reload: only what they change from then on is sent.
      loadedParagraphs.current = null;
      return;
    }
    const scheduler = createAiScheduler({
      fetch: (url, init) => fetch(url, init),
      loaded: loadedParagraphs.current ?? paragraphTexts(editor),
      // Results can arrive while the editor is mid-update (an undo back to text that is
      // already cached), so dispatch after it finishes.
      onResults: (matches) =>
        queueMicrotask(() => {
          if (!editor.isDestroyed) setExternalMatches(editor.view, matches);
        }),
      onStatus: setAiStatus,
    });
    // The same goes for a scheduler that replaces this one (AI switched off and on again).
    loadedParagraphs.current = null;
    schedulerRef.current = scheduler;
    feedScheduler(editor);
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
      // Its last status ("off", say) is not the next scheduler's.
      setAiStatus({ kind: "idle" });
      if (!editor.isDestroyed) setExternalMatches(editor.view, new Map());
    };
  }, [editor, ai, feedScheduler]);

  // The server first: on one without a key, pointing the writer to Settings would be a dead end.
  const aiPanel: AiPanelState = !ai
    ? { kind: aiLookupFailed ? "unknown" : "loading" }
    : !ai.configured
      ? { kind: "not_configured" }
      : !ai.enabled
        ? { kind: "off" }
        : { kind: "on", status: aiStatus };

  // Save whatever is queued when the tab is hidden or closed, and before signing out (which
  // ends the session before this component unmounts).
  useEffect(() => {
    const flush = () => void autosaver.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    const unregister = registerPendingSave(() => autosaver.flush());
    return () => {
      unregister();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [autosaver]);

  // Selects a range found by the Overview or the Review, and brings it to the middle of the
  // screen (the editor's own scrolling only just reveals it).
  const selectRange = useCallback(
    (range: DocRange | null) => {
      if (!editor || !range) return false;
      editor.chain().setTextSelection(range).focus().run();
      const { node } = editor.view.domAtPos(range.from);
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    },
    [editor],
  );

  const words = countWords(text);
  const targetWords = goals.targetWords;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
          {editor && <Toolbar editor={editor} />}
          <button
            type="button"
            onClick={() => setGoalsOpen(true)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Goals
          </button>
          <span
            className="ml-auto text-xs text-muted"
            role="status"
            aria-live="polite"
            data-testid="save-status"
          >
            {STATUS_LABEL[status]}
          </span>
        </div>

        <article className="mt-4 rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-12">
          <label htmlFor="doc-title" className="sr-only">
            Title
          </label>
          <input
            id="doc-title"
            value={title}
            placeholder="Untitled document"
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              queueSave({ title: e.target.value });
              if (editor) feedScheduler(editor);
            }}
            className="mb-6 w-full bg-transparent font-serif text-3xl font-semibold outline-none placeholder:text-muted/60"
          />
          <EditorContent editor={editor} />
        </article>

        <p className="mt-3 text-xs text-muted" data-testid="word-count">
          {formatNumber(words)}
          {targetWords ? ` / ${formatNumber(targetWords)}` : ""}{" "}
          {words === 1 && !targetWords ? "word" : "words"} · {formatNumber(countCharacters(text))}{" "}
          characters · {readingMinutes(words)} min read
        </p>
      </div>

      <div className="flex flex-col lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
        <PanelTabs
          label="Writing tools"
          idPrefix="panel"
          selected={tab}
          onSelect={setTab}
          tabs={[
            {
              id: "suggestions",
              label: "Suggestions",
              panel: (
                <SuggestionPanel
                  suggestions={suggestions}
                  activeKey={activeKey}
                  ai={aiPanel}
                  onActivate={(s) => {
                    if (!editor) return;
                    activateSuggestion(editor.view, s?.key ?? null);
                    if (s) {
                      editor.commands.setTextSelection(s.from);
                      editor.view.dom
                        .querySelector(`[data-suggestion-key="${CSS.escape(s.key)}"]`)
                        ?.scrollIntoView({ block: "center", behavior: "smooth" });
                    }
                  }}
                  onApply={(s, r) => {
                    if (!editor) return;
                    applySuggestion(editor.view, s, r);
                    editor.commands.focus();
                  }}
                  onDismiss={(s) => editor && dismissSuggestion(editor.view, s.key)}
                />
              ),
            },
            {
              id: "overview",
              label: "Overview",
              panel: (
                <OverviewPanel
                  active={tab === "overview"}
                  text={text}
                  layout={layout}
                  words={words}
                  getBlocks={() => (editor ? metricsBlocks(editor.state.doc) : [])}
                  suggestions={suggestions}
                  targetWords={targetWords}
                  onSelectSentence={(sentence) =>
                    !!editor && selectRange(findSentence(editor.state.doc, sentence))
                  }
                  onEditGoals={() => setGoalsOpen(true)}
                />
              ),
            },
            {
              id: "review",
              label: "Review",
              panel: (
                <ReviewPanel
                  documentId={doc.id}
                  active={tab === "review"}
                  ai={ai}
                  aiLookupFailed={aiLookupFailed}
                  words={words}
                  text={text}
                  layout={layout}
                  flushSave={flushSave}
                  onFindQuote={(quote) =>
                    !!editor && selectRange(findTextInDoc(editor.state.doc, quote))
                  }
                  onFindParagraph={(n) =>
                    !!editor && selectRange(findParagraph(editor.state.doc, n))
                  }
                />
              ),
            },
          ]}
        />
      </div>

      <GoalsDialog
        open={goalsOpen}
        goals={goals}
        onClose={() => setGoalsOpen(false)}
        onSave={(next) => {
          setGoals(next);
          goalsRef.current = next;
          setGoalsOpen(false);
          queueSave({ goals: next });
          if (editor) {
            recheckSuggestions(editor.view);
            feedScheduler(editor);
          }
        }}
      />
    </div>
  );
}
