import type { WritingGoals } from "@/lib/documents/schema";

/**
 * A copy of a document's unsaved state, kept in this tab's sessionStorage while saves are
 * failing (or the page is being left with a save still outstanding), so that an edit is not
 * lost when the writer navigates within Polaris, reloads, or signs in again. sessionStorage
 * belongs to the tab and is gone when it closes, and signing out clears it, so the text does
 * not linger on a shared computer.
 */
export interface Draft {
  content: unknown;
  title: string;
  goals: WritingGoals;
  /** The version the edits were made on: restoring sends it, so a newer save is not overwritten. */
  baseVersion: number;
  savedAt: string;
}

const PREFIX = "polaris:draft:";
const key = (documentId: string) => `${PREFIX}${documentId}`;

export function saveDraft(documentId: string, draft: Draft): void {
  try {
    sessionStorage.setItem(key(documentId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the editor still holds the text, and still says it is unsaved.
  }
}

export function readDraft(documentId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key(documentId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (
      typeof draft.title !== "string" ||
      typeof draft.baseVersion !== "number" ||
      typeof draft.savedAt !== "string" ||
      typeof draft.content !== "object" ||
      draft.content === null
    ) {
      return null;
    }
    return { goals: {}, ...draft } as Draft;
  } catch {
    return null;
  }
}

export function clearDraft(documentId: string): void {
  try {
    sessionStorage.removeItem(key(documentId));
  } catch {
    // Nothing to do.
  }
}

/** Forgets every draft in this tab (on sign-out). */
export function clearAllDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // Nothing to do.
  }
}

/**
 * Whether a request with this body may use `keepalive` (which lets it finish after the page
 * is gone): browsers refuse keepalive bodies over 64 KiB outright, so a larger document must
 * be sent without it, or every save of it fails.
 */
export function keepaliveAllowed(body: string): boolean {
  const limit = 60 * 1024;
  // UTF-8 takes at least one byte per UTF-16 unit and at most three: only count when it matters.
  if (body.length > limit) return false;
  if (body.length * 3 <= limit) return true;
  return new TextEncoder().encode(body).length <= limit;
}
