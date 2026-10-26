"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paragraphGoals } from "@/lib/ai/protocol";
import { createAutosaver, registerPendingSave, type SaveStatus } from "@/lib/autosave";
import {
  blocksFromContent,
  blocksLayout,
  footnotesLayout,
  reviewBlocks,
} from "@/lib/documents/blocks";
import type { DocumentDTO } from "@/lib/documents/service";
import type { UpdateDocumentInput, WritingGoals } from "@/lib/documents/schema";
import { createAiScheduler, type AiScheduler, type AiStatus } from "@/lib/editor/ai-scheduler";
import { documentExtensions } from "@/lib/editor/extensions";
import {
  cancelFootnote,
  collectFootnotes,
  cursorAfterFootnote,
  deleteFootnote,
  insertFootnote,
  saveFootnote,
  selectFootnote,
  type FootnoteTarget,
} from "@/lib/editor/footnote";
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
import { adjacentSuggestion, readingOrder } from "@/lib/editor/suggestion-nav";
import { collectTextBlocks, withoutFootnotes } from "@/lib/editor/textblocks";
import {
  clearDraft,
  keepaliveAllowed,
  readDraft,
  saveDraft,
  type Draft,
} from "@/lib/editor/drafts";
import { SESSION_EXPIRED_PATH } from "@/lib/auth/routes";
import { documentTitle, pageTitle } from "@/lib/page-title";
import { detectPlatform, isTextField, matchEditorShortcut } from "@/lib/shortcuts";
import { countCharacters, countWords, readingMinutes } from "@/lib/text/stats";
import { ExportMenu, type ExportFormat } from "./ExportMenu";
import { FirstRunHelp } from "./FirstRunHelp";
import { FootnoteDialog, type FootnoteAction } from "./FootnoteDialog";
import { FootnoteList, type FootnoteEntry } from "./FootnoteList";
import { GoalsDialog } from "./GoalsDialog";
import { ImportNotice } from "./ImportNotice";
import { LinkDialog, type LinkRequest, type LinkResult } from "./LinkDialog";
import { OverviewPanel } from "./OverviewPanel";
import { PanelTabs, useRememberedTab } from "./PanelTabs";
import { ReviewPanel } from "./ReviewPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SuggestionPanel, type AiPanelState } from "./SuggestionPanel";
import { Toolbar } from "./Toolbar";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
import { formatNumber } from "@/lib/text/format";
import { LocalDateTime } from "./LocalDateTime";

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  pending: "Unsaved changes",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Couldn’t save. Retrying…",
};

/** A save the server refused for a reason a retry will not fix (a conflict, a limit). */
class SaveRefused extends Error {
  constructor(readonly reason: "conflict" | "refused") {
    super(`Save refused: ${reason}`);
  }
}

/** A save the server asked to retry later (rate limited). */
class SaveRetryAfter extends Error {
  constructor(readonly ms: number) {
    super("Save rate limited");
  }
}

/** The status while saves are refused because this device's session has ended. */
const SIGNED_OUT_LABEL = "Not saved: you’re signed out.";

const BLOCK_SEPARATOR = "\n\n";

/** Whether this writer gets AI suggestions here: their setting, and whether the server can. */
interface AiAvailability {
  enabled: boolean;
  configured: boolean;
}

/** What Claude is sent of each paragraph: its text without footnote markers. */
const paragraphTexts = (editor: Editor) =>
  collectTextBlocks(editor.state.doc).map((b) => withoutFootnotes(b).text);

/** The footnotes for the list under the article (no positions: they change on every edit). */
const footnoteEntries = (editor: Editor): FootnoteEntry[] =>
  collectFootnotes(editor.state.doc).map(({ id, content, number }) => ({ id, content, number }));

const sameEntries = (a: FootnoteEntry[], b: FootnoteEntry[]) =>
  a.length === b.length &&
  a.every((f, i) => f.id === b[i]!.id && f.content === b[i]!.content && f.number === b[i]!.number);

const PANEL_TABS = ["suggestions", "overview", "review"] as const;
type PanelTabId = (typeof PANEL_TABS)[number];
/** localStorage key for the tab the writer last chose, in this browser. */
export const PANEL_TAB_KEY = "polaris:panel-tab";

export function DocumentEditor({ document: doc }: { document: DocumentDTO }) {
  const [title, setTitle] = useState(doc.title === "Untitled document" ? "" : doc.title);
  const [goals, setGoals] = useState<WritingGoals>(doc.goals);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Whether the document was empty when it opened: the first-run help is for a new document.
  const [openedEmpty] = useState(() => doc.plainText.trim() === "");
  // What Alt+] / Alt+[ moved to, for screen readers (focus stays in the text).
  const [navMessage, setNavMessage] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Whether the last save was refused with a 401: this device was signed out (a password
  // change or "Sign out of all other devices" elsewhere, or a session that simply ended). Until
  // a save goes through again, every retry would be refused too, so the writer is told.
  const [signedOut, setSignedOut] = useState(false);
  // Why the server refused the last save outright (a storage limit, a document too large).
  const [saveRefusal, setSaveRefusal] = useState<string | null>(null);
  // Unsaved edits this tab kept from an earlier visit to the document (src/lib/editor/drafts.ts).
  const [draft, setDraft] = useState<Draft | null>(null);
  const router = useRouter();
  const [text, setText] = useState(doc.plainText);
  // Which blocks are headings: from the saved document until the editor has it, then from the
  // editor on every change. The same string either way, so a review loaded early is not stale.
  const [layout, setLayout] = useState(() => blocksLayout(reviewBlocks(doc)));
  // Where the footnotes are and what they say: a review reads them too, so it is stale when
  // they change (footnotesLayout() in src/lib/documents/blocks.ts, on both sides).
  const [notesLayout, setNotesLayout] = useState(() => footnotesLayout(reviewBlocks(doc)));
  const [footnotes, setFootnotes] = useState<FootnoteEntry[]>([]);
  const [footnoteTarget, setFootnoteTarget] = useState<FootnoteTarget | null>(null);
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
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
  const suggestionsRef = useRef<Suggestion[]>([]);
  suggestionsRef.current = suggestions;
  // The editor is built once; these let its shortcuts and markers reach the current handlers.
  const openFootnoteRef = useRef<(target: FootnoteTarget) => void>(() => {});
  const openLinkRef = useRef<() => void>(() => {});

  // Rules read goals through a ref, so changing them does not rebuild the editor.
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const titleRef = useRef(title);
  titleRef.current = title;
  const titleInput = useRef<HTMLInputElement>(null);

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

  // Every field touched since the last save that went through. A save takes all of it; if the
  // save fails, its fields are merged back under anything edited since, so nothing (a title
  // change behind a later content edit, say) is dropped.
  const pending = useRef<UpdateDocumentInput>({});
  // The version this editor's text is based on: sent with every save, so a save from a stale
  // copy (another tab saved since, or Back restored an old page) is refused, not applied.
  const versionRef = useRef(doc.version);
  const editorRef = useRef<Editor | null>(null);
  const [conflict, setConflict] = useState<{ version: number } | null>(null);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  // Set while leaving on purpose (discarding a conflicted copy), so the unload prompt stays quiet.
  const leavingRef = useRef(false);

  /** Keeps a copy of everything unsaved in this tab, in case the save never gets through. */
  const backUpDraft = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    saveDraft(doc.id, {
      content: editor.getJSON(),
      title: titleRef.current,
      goals: goalsRef.current,
      baseVersion: versionRef.current,
      savedAt: new Date().toISOString(),
    });
  }, [doc.id]);

  const autosaver = useMemo(
    () =>
      createAutosaver<true>(
        async () => {
          // This save owns every field queued so far; later edits start a new patch.
          const patch = pending.current;
          pending.current = {};
          const restore = () => {
            pending.current = { ...patch, ...pending.current };
            backUpDraft();
          };
          const body = JSON.stringify({ ...patch, baseVersion: versionRef.current });
          let res: Response;
          try {
            res = await fetch(`/api/documents/${doc.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body,
              // Lets a save started as the page closes finish, but browsers refuse keepalive
              // bodies over 64 KiB, which would make every save of a long document fail.
              keepalive: keepaliveAllowed(body),
            });
          } catch (err) {
            restore();
            throw err;
          }
          if (!res.ok) {
            restore();
            if (res.status === 401) setSignedOut(true);
            if (res.status === 409) {
              const info = (await res.json().catch(() => null)) as { version?: number } | null;
              setConflict({ version: info?.version ?? versionRef.current });
              throw new SaveRefused("conflict");
            }
            if (res.status === 429) {
              throw new SaveRetryAfter(Number(res.headers.get("retry-after")) * 1000 || 5000);
            }
            if (res.status === 403 || res.status === 413) {
              const info = (await res.json().catch(() => null)) as { error?: string } | null;
              setSaveRefusal(info?.error ?? "This document could not be saved.");
              throw new SaveRefused("refused");
            }
            throw new Error(`Save failed: ${res.status}`);
          }
          const saved = (await res.json()) as { version: number };
          versionRef.current = saved.version;
          setSignedOut(false);
          setSaveRefusal(null);
          if (Object.keys(pending.current).length === 0) clearDraft(doc.id);
        },
        {
          onStatus: setStatus,
          retryAfterMs: (err) =>
            err instanceof SaveRefused ? null : err instanceof SaveRetryAfter ? err.ms : undefined,
        },
      ),
    [doc.id, backUpDraft],
  );

  const queueSave = useCallback(
    (patch: UpdateDocumentInput) => {
      pending.current = { ...pending.current, ...patch };
      autosaver.schedule(true);
    },
    [autosaver],
  );

  /**
   * Saves everything now, for a review of the document as the writer sees it; a save that
   * failed earlier is retried. False if the server still does not have the latest text.
   */
  const flushSave = useCallback(() => autosaver.flush(), [autosaver]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // The document's schema (src/lib/editor/extensions.ts), shared with the importer.
      ...documentExtensions({
        onEditFootnote: (target) => openFootnoteRef.current(target),
        onLinkShortcut: () => openLinkRef.current(),
      }),
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
      editorRef.current = editor;
      loadedParagraphs.current ??= paragraphTexts(editor);
      setLayout(blockLayout(editor.state.doc));
      setFootnotes(footnoteEntries(editor));
      // Edits this tab could not save on an earlier visit, offered back unless they are what
      // the server already has.
      const kept = readDraft(doc.id);
      if (
        kept &&
        JSON.stringify(kept.content) === JSON.stringify(editor.getJSON()) &&
        kept.title === titleRef.current
      ) {
        clearDraft(doc.id);
      } else if (kept) {
        setDraft(kept);
      }
    },
    editorProps: {
      attributes: {
        class: "polaris-prose",
        "aria-label": "Document body",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => {
      // Footnotes render no text, so they are not in the plain text or the word count.
      const plainText = editor.getText({ blockSeparator: BLOCK_SEPARATOR });
      const content = editor.getJSON();
      setText(plainText);
      setLayout(blockLayout(editor.state.doc));
      setNotesLayout(footnotesLayout(blocksFromContent(content) ?? []));
      const entries = footnoteEntries(editor);
      setFootnotes((prev) => (sameEntries(prev, entries) ? prev : entries));
      queueSave({ content, plainText });
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
  // Anything still unsaved also goes into this tab's draft copy first: a long document's save
  // cannot use keepalive, so it may not finish once the page is gone.
  useEffect(() => {
    const flush = () => {
      if (autosaver.unsaved && !leavingRef.current) backUpDraft();
      void autosaver.flush();
    };
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
  }, [autosaver, backUpDraft]);

  // Is this copy out of date? Back can restore the page as it was first loaded, and another
  // tab may have saved since. Asked when the editor opens and whenever the writer comes back
  // to the tab; with nothing unsaved here, the page reloads its data (the editor is keyed by
  // version, so it starts again from the newer text). With unsaved edits, the next save is
  // refused instead and the writer chooses (the conflict notice).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (cancelled || autosaver.unsaved || conflictRef.current) return;
      const res = await fetch(`/api/documents/${doc.id}?fields=version`, {
        cache: "no-store",
      }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const { version } = (await res.json()) as { version: number };
      if (version > versionRef.current && !autosaver.unsaved) router.refresh();
    };
    void check();
    const onReturn = () => document.visibilityState === "visible" && void check();
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [autosaver, doc.id, router]);

  /** Conflict: overwrite the saved version with this tab's text, or give this tab's text up. */
  const keepMine = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !conflictRef.current) return;
    versionRef.current = conflictRef.current.version;
    setConflict(null);
    queueSave({
      title: titleRef.current,
      goals: goalsRef.current,
      content: editor.getJSON(),
      plainText: editor.getText({ blockSeparator: BLOCK_SEPARATOR }),
    });
    void autosaver.flush();
  }, [autosaver, queueSave]);
  const loadSaved = useCallback(() => {
    leavingRef.current = true;
    autosaver.cancel();
    pending.current = {};
    clearDraft(doc.id);
    window.location.reload();
  }, [autosaver, doc.id]);

  /** Restores the draft this tab kept, as edits on the version it was made from. */
  const restoreDraft = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !draft) return;
    versionRef.current = draft.baseVersion;
    setTitle(draft.title);
    setGoals(draft.goals);
    goalsRef.current = draft.goals;
    titleRef.current = draft.title;
    setDraft(null);
    editor.commands.setContent(draft.content as JSONContent, { emitUpdate: true });
    queueSave({ title: draft.title, goals: draft.goals });
  }, [draft, queueSave]);
  const discardDraft = useCallback(() => {
    clearDraft(doc.id);
    setDraft(null);
  }, [doc.id]);

  // The browser tab shows the title as it is typed (the server's metadata has the saved one).
  useEffect(() => {
    document.title = pageTitle(documentTitle(title));
  }, [title]);

  // Leaving with an edit not yet saved asks first.
  useUnsavedChangesGuard(status, leavingRef);

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

  // Alt+] / Alt+[: select the next (previous) suggestion in the text and open its card. Focus
  // goes to the text, so the writer can fix it there or press Escape to close the card.
  const goToSuggestion = useCallback(
    (direction: 1 | -1) => {
      if (!editor) return;
      const list = suggestionsRef.current;
      const target = adjacentSuggestion(
        list,
        {
          activeKey: activeKeyRef.current,
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        },
        direction,
      );
      if (!target) {
        setNavMessage("No suggestions to move to.");
        return;
      }
      editor.chain().setTextSelection({ from: target.from, to: target.to }).focus().run();
      activateSuggestion(editor.view, target.key);
      editor.view.dom
        .querySelector(`[data-suggestion-key="${CSS.escape(target.key)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      const index = readingOrder(list).findIndex((s) => s.key === target.key) + 1;
      setNavMessage(`Suggestion ${index} of ${list.length}: ${target.message}`);
    },
    [editor],
  );

  // The editor's own shortcuts, wherever focus is on the page (except in a modal dialog, which
  // has the keyboard to itself, and keys something else already handled, such as Escape in
  // the Export menu).
  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || document.querySelector("dialog[open]")) return;
      // ProseMirror cancels every Escape (and Enter) typed in the text, handled or not, so only
      // a key cancelled elsewhere counts as taken.
      const inText = e.target instanceof Node && editor.view.dom.contains(e.target);
      if (e.defaultPrevented && !inText) return;
      const command = matchEditorShortcut(
        e,
        isTextField(e.target as Element | null),
        detectPlatform(navigator),
      );
      if (command === null) return;
      if (command === "close-suggestion") {
        if (activeKeyRef.current === null) return;
        e.preventDefault();
        activateSuggestion(editor.view, null);
        editor.commands.focus();
        return;
      }
      e.preventDefault();
      if (command === "show-shortcuts") setShortcutsOpen(true);
      else goToSuggestion(command === "next-suggestion" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, goToSuggestion]);

  const openFootnote = useCallback((target: FootnoteTarget) => setFootnoteTarget(target), []);
  openFootnoteRef.current = openFootnote;

  const insertNewFootnote = useCallback(() => {
    if (!editor) return;
    const target = insertFootnote(editor);
    if (target) setFootnoteTarget(target);
    else editor.commands.focus();
  }, [editor]);

  const finishFootnote = useCallback(
    (target: FootnoteTarget, action: FootnoteAction) => {
      setFootnoteTarget(null);
      if (!editor) return;
      if (action.kind === "save") saveFootnote(editor, target, action.content);
      else if (action.kind === "delete") deleteFootnote(editor, target);
      else cancelFootnote(editor, target);
      // Back to the text, right after the marker (or where it was).
      if (!cursorAfterFootnote(editor, target.id)) editor.commands.focus();
    },
    [editor],
  );

  const openLink = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes("link").href;
    setLinkRequest({
      href: typeof href === "string" ? href : "",
      hasText: !editor.state.selection.empty || editor.isActive("link"),
    });
  }, [editor]);
  openLinkRef.current = openLink;

  const finishLink = useCallback(
    (href: LinkResult) => {
      setLinkRequest(null);
      if (!editor) return;
      const chain = editor.chain().focus();
      if (href === null) {
        chain.run();
      } else if (href === "") {
        chain.extendMarkRange("link").unsetLink().run();
      } else if (editor.state.selection.empty && !editor.isActive("link")) {
        // Nothing selected: the address itself becomes the linked text.
        chain
          .insertContent({
            type: "text",
            text: href.replace(/^mailto:/i, ""),
            marks: [{ type: "link", attrs: { href } }],
          })
          .run();
      } else {
        chain.extendMarkRange("link").setLink({ href }).run();
      }
    },
    [editor],
  );

  // Exports exactly what the editor shows: its current content and the title as typed.
  const exportAs = useCallback(
    async (format: ExportFormat) => {
      if (!editor) return;
      if (format === "print") {
        window.print();
        return;
      }
      const content = editor.getJSON();
      const [{ downloadBlob, MIME }, { exportFileName }] = await Promise.all([
        import("@/lib/export/download"),
        import("@/lib/export/filename"),
      ]);
      let blob: Blob;
      if (format === "docx") {
        const { exportDocx } = await import("@/lib/export/docx");
        blob = await exportDocx(content, title);
      } else if (format === "md") {
        const { toMarkdown } = await import("@/lib/export/markdown");
        blob = new Blob([toMarkdown(content, title)], { type: MIME.md });
      } else {
        const { toPlainText } = await import("@/lib/export/text");
        blob = new Blob([toPlainText(content, title)], { type: MIME.txt });
      }
      downloadBlob(blob, exportFileName(title, format));
    },
    [editor, title],
  );

  const words = countWords(text);
  const targetWords = goals.targetWords;

  return (
    <div
      className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      data-print="layout"
    >
      <div className="min-w-0">
        <div
          className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur"
          data-print="hide"
          data-testid="editor-toolbar"
        >
          {editor && <Toolbar editor={editor} onLink={openLink} onFootnote={insertNewFootnote} />}
          <button
            type="button"
            onClick={() => setGoalsOpen(true)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Goals
          </button>
          <ExportMenu onExport={exportAs} />
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            aria-haspopup="dialog"
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="Shift+?"
            title="Keyboard shortcuts (Shift+?)"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Shortcuts
          </button>
          <span
            className="ml-auto text-xs text-muted"
            role="status"
            aria-live="polite"
            data-testid="save-status"
          >
            {signedOut && status === "error" ? SIGNED_OUT_LABEL : STATUS_LABEL[status]}
          </span>
        </div>

        {signedOut && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            data-print="hide"
            data-testid="signed-out-notice"
          >
            <p className="font-semibold">
              You were signed out, so your latest changes are not saved yet.
            </p>
            <p className="mt-1">
              Keep this tab open.{" "}
              <a href={SESSION_EXPIRED_PATH} target="_blank" rel="noopener" className="underline">
                Sign in again in a new tab
              </a>
              , then come back here and keep writing: everything since is saved with your next edit.
              If you can’t sign in, copy your recent changes somewhere safe before leaving this
              page.
            </p>
          </div>
        )}

        {conflict && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
            data-print="hide"
            data-testid="conflict-notice"
          >
            <p className="font-semibold">
              This document was changed somewhere else, so your latest edits here are not saved.
            </p>
            <p className="mt-1">
              It may be open in another tab or on another device. Keep this version to save it over
              the other one, or load the saved version (your edits here are then lost).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={keepMine}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-black"
              >
                Keep this version
              </button>
              <button
                type="button"
                onClick={loadSaved}
                className="rounded-md border border-border bg-surface px-3 py-1.5"
              >
                Load the saved version
              </button>
            </div>
          </div>
        )}

        {saveRefusal && status === "error" && !conflict && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-5 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            data-print="hide"
          >
            {saveRefusal} Your latest edits are kept in this tab until they can be saved.
          </p>
        )}

        {draft && (
          <div
            role="region"
            aria-label="Unsaved edits"
            className="mt-4 rounded-lg border border-border bg-surface px-5 py-4 text-sm"
            data-print="hide"
            data-testid="draft-notice"
          >
            <p className="font-semibold">This tab kept edits that were not saved.</p>
            <p className="mt-1 text-muted">
              From <LocalDateTime iso={draft.savedAt} />. Restore them to carry on where you left
              off, or discard them to keep the document as saved.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={restoreDraft}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-black"
              >
                Restore my edits
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="rounded-md border border-border bg-surface px-3 py-1.5"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* What the importer left out of this document, said once when it first opens. */}
        <ImportNotice documentId={doc.id} />
        <FirstRunHelp
          emptyDocument={openedEmpty}
          ai={ai}
          onDismissFocus={() => titleInput.current?.focus()}
        />
        <p role="status" className="sr-only" data-testid="suggestion-nav-status">
          {navMessage}
        </p>

        <article
          className="mt-4 rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-12"
          data-print="article"
        >
          {/* The title as printed: an input prints as a box. */}
          <h1 className="polaris-print-title hidden">{title || "Untitled document"}</h1>
          <label htmlFor="doc-title" className="sr-only">
            Title
          </label>
          <input
            ref={titleInput}
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
            data-print="hide"
          />
          <EditorContent editor={editor} />
          <FootnoteList
            footnotes={footnotes}
            onEdit={(f) => {
              if (!editor) return;
              const target = collectFootnotes(editor.state.doc).find((x) => x.id === f.id);
              if (target)
                setFootnoteTarget({
                  id: target.id,
                  number: target.number,
                  content: target.content,
                });
            }}
            onShowMarker={(f) => !!editor && selectFootnote(editor, f.id)}
          />
        </article>

        <p className="mt-3 text-xs text-muted" data-testid="word-count" data-print="hide">
          {formatNumber(words)}
          {targetWords ? ` / ${formatNumber(targetWords)}` : ""}{" "}
          {words === 1 && !targetWords ? "word" : "words"} · {formatNumber(countCharacters(text))}{" "}
          characters · {readingMinutes(words)} min read
        </p>
      </div>

      <div
        className="flex flex-col lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]"
        data-print="hide"
        data-testid="side-panel"
      >
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
                  footnotes={notesLayout}
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

      <FootnoteDialog target={footnoteTarget} onDone={finishFootnote} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <LinkDialog request={linkRequest} onDone={finishLink} />

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
