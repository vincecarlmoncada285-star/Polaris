"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * What a page that failed shows: a plain apology, "Try again" and a way home. Never the error
 * itself: a server error's message and stack are logged on the server, and only its digest (an
 * opaque id to find it in those logs) reaches the browser.
 *
 * Try again fetches the page from the server again and then calls `reset`: reset alone only
 * re-renders what the browser already has, which for a page that failed on the server (the
 * database busy, say) is the same error.
 */
export function ErrorMessage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const tryAgain = () =>
    startRetry(() => {
      router.refresh();
      reset();
    });

  useEffect(() => {
    // For whoever opens the console: an id they can quote, nothing more.
    if (error.digest) console.error(`Polaris page error, reference ${error.digest}`);
  }, [error.digest]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-sm font-medium text-muted">Something went wrong</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold">This page couldn’t be shown</h1>
      <p className="mt-3 text-muted">
        Polaris ran into a problem. What you have already saved is safe. Try again, or go back to
        your documents.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-muted" data-testid="error-reference">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {/* aria-disabled while retrying, so focus stays on the button. */}
        <button
          type="button"
          onClick={() => !retrying && tryAgain()}
          aria-disabled={retrying || undefined}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white aria-disabled:opacity-60 dark:text-black"
        >
          Try again
        </button>
        {/* A full page load, not a client navigation: the app's state may be what broke. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          Back to your documents
        </a>
      </div>
    </div>
  );
}
