"use client";

import { ErrorMessage } from "@/components/ErrorMessage";

// A page (or the data it loads) failed; the navbar and footer around it still render.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorMessage error={error} reset={reset} />;
}
