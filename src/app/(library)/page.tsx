import type { Metadata } from "next";
import { documents } from "@/lib/documents";
import { requirePageUser } from "@/lib/auth/session";
import { DocumentLibrary } from "@/components/DocumentLibrary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your documents" };

export default async function Home() {
  const user = await requirePageUser("/");
  const docs = await documents.list(user.id);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <DocumentLibrary initialDocuments={docs} userId={user.id} />
    </div>
  );
}
