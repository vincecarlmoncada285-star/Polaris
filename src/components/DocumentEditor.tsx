"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAutosaver, registerPendingSave, type SaveStatus } from "@/lib/autosave";
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
import { collectTextBlocks } from "@/lib/editor/textblocks";
import { countCharacters, countWords, readingMinutes } from "@/lib/text/stats";
import { GoalsDialog } from "./GoalsDialog";
import { SuggestionPanel, type AiPanelState } from "./SuggestionPanel";
import { Toolbar } from "./Toolbar";

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

export function DocumentEditor({ document: doc }: { document: DocumentDTO }) {
  const [title, setTitle] = useState(doc.title === "Untitled document" ? "" : doc.title);
  const [goals, setGoals] = useState<WritingGoals>(doc.goals);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [text, setText] = useState(doc.plainText);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [ai, setAi] = useState<AiAvailability | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ kind: "idle" });

  // Rules read goals through a ref, so changing them does not rebuild the editor.
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const titleRef = useRef(title);
  titleRef.current = title;

  // Present only while AI suggestions are on and the server can provide them.
  const schedulerRef = useRef<AiScheduler | null>(null);
  const feedScheduler = useCallback((editor: Editor) => {
    schedulerRef.current?.update({
      paragraphs: collectTextBlocks(editor.state.doc).map((b) => b.text),
      goals: goalsRef.current,
      title: titleRef.current,
    });
  }, []);

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
        },
      }),
    ],
    content: (doc.content as JSONContent | null) ?? undefined,
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
      queueSave({ content: editor.getJSON(), plainText });
      feedScheduler(editor);
    },
  });

  // The AI setting lives in the database and the key on the server, so ask once per visit.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { aiEnabled?: boolean; aiConfigured?: boolean } | null) => {
        if (!cancelled && me) setAi({ enabled: !!me.aiEnabled, configured: !!me.aiConfigured });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Paragraph text goes to the server only from here, and only when the writer turned AI on.
  useEffect(() => {
    if (!editor || !ai?.enabled || !ai.configured) return;
    const scheduler = createAiScheduler({
      fetch: (url, init) => fetch(url, init),
      // Results can arrive while the editor is mid-update (an undo back to text that is
      // already cached), so dispatch after it finishes.
      onResults: (matches) =>
        queueMicrotask(() => {
          if (!editor.isDestroyed) setExternalMatches(editor.view, matches);
        }),
      onStatus: setAiStatus,
    });
    schedulerRef.current = scheduler;
    feedScheduler(editor);
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
      if (!editor.isDestroyed) setExternalMatches(editor.view, new Map());
    };
  }, [editor, ai, feedScheduler]);

  const aiPanel: AiPanelState = !ai
    ? { kind: "loading" }
    : !ai.enabled
      ? { kind: "off" }
      : !ai.configured
        ? { kind: "not_configured" }
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

  const words = countWords(text);

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
          {words.toLocaleString()} {words === 1 ? "word" : "words"} ·{" "}
          {countCharacters(text).toLocaleString()} characters · {readingMinutes(words)} min read
        </p>
      </div>

      <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
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
