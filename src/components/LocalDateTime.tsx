"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * A date in the reader's own timezone. The server cannot know that timezone, so the first render
 * (on the server, and during hydration) shows the date in UTC, labelled as such, and the client
 * then switches to local time. Formatting with the runtime's timezone directly would make the
 * server and client text differ, which React reports as a hydration mismatch.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = hydrated
    ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : `${date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  return <time dateTime={iso}>{text}</time>;
}
