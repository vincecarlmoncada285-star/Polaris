"use client";

import { useState } from "react";
import { useAnnouncementKey } from "../auth/useAnnouncement";
import { errorMessage } from "./api";
import { SectionCard } from "./SectionCard";

/** What the button does: shown before it, so the writer knows this device is not affected. */
export const OTHER_DEVICES_EXPLANATION =
  "Signs you out of Polaris in every other browser and on every other device, for example a shared computer you forgot to sign out of. This browser stays signed in. Changing your password does this too.";

export function OtherDevices() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const alertKey = useAnnouncementKey(error);

  async function signOutOthers() {
    // aria-disabled rather than disabled while busy, so keyboard focus stays on the button.
    if (busy) return;
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      const res = await fetch("/api/me/sign-out-others", { method: "POST" });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Couldn’t sign out your other devices."));
      }
      setDone(true);
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "Couldn’t sign out your other devices.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard id="other-devices" title="Signed-in devices">
      <p id="other-devices-description" className="text-sm text-muted">
        {OTHER_DEVICES_EXPLANATION}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={signOutOthers}
          aria-disabled={busy || undefined}
          aria-describedby="other-devices-description"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background aria-disabled:opacity-60"
        >
          {busy ? "Signing out…" : "Sign out of all other devices"}
        </button>
        <span role="status" className="text-sm text-muted">
          {done ? "Signed out of all other devices." : ""}
        </span>
      </div>
      {error && (
        <p key={alertKey} role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}
    </SectionCard>
  );
}
