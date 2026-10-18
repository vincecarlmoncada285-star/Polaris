import type { Metadata, Viewport } from "next";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_NAME, TITLE_TEMPLATE } from "@/lib/page-title";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: TITLE_TEMPLATE },
  description:
    "Polaris is an open-source writing companion for academic writing: it explains what it flags, so students learn the conventions instead of just accepting fixes.",
};

// The browser's own UI (a phone's address bar, say) in the page's background colour.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-border bg-surface">
          <Navbar />
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
