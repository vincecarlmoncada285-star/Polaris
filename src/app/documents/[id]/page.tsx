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
  return <DocumentEditor document={doc} />;
}
