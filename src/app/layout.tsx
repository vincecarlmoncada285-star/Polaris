import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polaris",
  description: "Feedback for academic writing",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="text-accent">
                ✦
              </span>{" "}
              Polaris
            </Link>
            <Link href="/" className="text-sm text-muted hover:text-foreground">
              Documents
            </Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
