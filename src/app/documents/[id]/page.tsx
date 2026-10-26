import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requirePageUser } from "@/lib/auth/session";
import { documentTitle } from "@/lib/page-title";
import { DocumentEditor } from "@/components/DocumentEditor";
import { loadDocument } from "./load";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const doc = user ? await loadDocument(user.id, id) : null;
  return { title: doc ? documentTitle(doc.title) : "Page not found" };
}

export default async function DocumentPage({ params }: { params: Params }) {
  const { id } = await params;
  // The layout has already checked both; these are the same (cached) lookups.
  const user = await requirePageUser(`/documents/${encodeURIComponent(id)}`);
  const doc = await loadDocument(user.id, id);
  if (!doc) notFound();
  // Keyed by version: when the editor learns its copy is out of date and refreshes the page,
  // it starts again from the newer text instead of keeping the old one.
  return <DocumentEditor key={`${doc.id}:${doc.version}`} document={doc} />;
}
