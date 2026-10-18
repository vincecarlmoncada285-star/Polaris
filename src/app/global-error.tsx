"use client";

import { ErrorMessage } from "@/components/ErrorMessage";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

// The root layout itself failed, so this replaces it, <html> and all.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <title>Something went wrong · Polaris</title>
        <main id="main" className="flex-1">
          <ErrorMessage error={error} reset={reset} />
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
