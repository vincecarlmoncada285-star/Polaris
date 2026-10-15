import { documents } from "@/lib/documents";
import { DocumentLibrary } from "@/components/DocumentLibrary";

export const dynamic = "force-dynamic";

export default async function Home() {
  const docs = await documents.list();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <DocumentLibrary initialDocuments={docs} />
    </div>
  );
}
