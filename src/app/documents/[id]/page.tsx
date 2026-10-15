import { notFound } from "next/navigation";
import { documents } from "@/lib/documents";
import { requirePageUser } from "@/lib/auth/session";
import { DocumentEditor } from "@/components/DocumentEditor";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/documents/${encodeURIComponent(id)}`);
  // Someone else's document gets the same 404 as one that does not exist.
  const doc = await documents.get(user.id, id);
  if (!doc) notFound();
  return <DocumentEditor document={doc} />;
}
