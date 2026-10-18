"use client";

import { useEffect } from "react";
import type { SaveStatus } from "@/lib/autosave";

/** Whether leaving now could lose an edit: one is waiting to be saved, being saved, or failed. */
export function hasUnsavedChanges(status: SaveStatus): boolean {
  return status === "pending" || status === "saving" || status === "error";
}

/**
 * Asks the browser to confirm before the page is closed or reloaded, but only while
 * `hasUnsavedChanges(status)`: a prompt on every exit would teach writers to click through it.
 * (The editor also saves on pagehide, which is often enough; this covers the rest.)
 */
export function useUnsavedChangesGuard(status: SaveStatus): void {
  const guard = hasUnsavedChanges(status);
  useEffect(() => {
    if (!guard) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guard]);
}
