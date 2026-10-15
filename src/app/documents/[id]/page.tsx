import { notFound } from "next/navigation";
import { documents } from "@/lib/documents";
import { DocumentEditor } from "@/components/DocumentEditor";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const doc = await documents.get((await params).id);
  if (!doc) notFound();
  return <DocumentEditor document={doc} />;
}
