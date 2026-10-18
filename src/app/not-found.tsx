import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold">Page not found</h1>
      <p className="mt-3 text-muted">This page does not exist, or it belongs to another account.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black"
      >
        Back to your documents
      </Link>
    </div>
  );
}
