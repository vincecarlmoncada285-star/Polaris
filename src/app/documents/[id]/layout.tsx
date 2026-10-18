import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/session";
import { loadDocument } from "./load";

/**
 * Settles who is asking and whether the document is theirs before anything is sent. The
 * loading skeleton (loading.tsx) sits inside this layout, so the page streams in behind it;
 * a redirect or a 404 from the page itself would come after the response had started as a 200.
 */
export default async function DocumentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/documents/${encodeURIComponent(id)}`);
  if (!(await loadDocument(user.id, id))) notFound();
  return children;
}
