import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { updateDocumentSchema } from "@/lib/documents/schema";
import { DocumentConflictError } from "@/lib/documents/service";
import { DOCUMENT_BODY_BYTES, refuseSave } from "@/lib/documents/writes";
import { crossSiteRefusal, readJson } from "@/lib/http/request";

type Ctx = { params: Promise<{ id: string }> };

// Also the answer for another user's document: a 403 would confirm that the id exists.
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * The document, or with `?fields=version` only its version and save time: an open editor asks
 * that to learn whether it is showing an out-of-date copy (another tab saved, or Back restored
 * an old page), without downloading the whole document.
 */
export async function GET(req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  if (new URL(req.url).searchParams.get("fields") === "version") {
    const version = await documents.version(userId, id);
    return version
      ? NextResponse.json(version, { headers: { "Cache-Control": "no-store" } })
      : notFound();
  }
  const doc = await documents.get(userId, id);
  return doc ? NextResponse.json(doc) : notFound();
}

/**
 * A save. Answers with the new version (not the document: autosave sends this every few
 * seconds). 409 when `baseVersion` is given and the document has moved on since.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const crossSite = crossSiteRefusal(req);
  if (crossSite) return crossSite;
  const body = await readJson(req, DOCUMENT_BODY_BYTES, "This document is too large.");
  if (!body.ok) return body.response;
  const parsed = updateDocumentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const refused = await refuseSave(userId, id, parsed.data);
  if (refused) return refused;
  try {
    const saved = await documents.update(userId, id, parsed.data);
    return saved ? NextResponse.json(saved) : notFound();
  } catch (err) {
    if (!(err instanceof DocumentConflictError)) throw err;
    return NextResponse.json(
      {
        error: "This document was changed somewhere else since you opened it.",
        code: "conflict",
        version: err.version,
        updatedAt: err.updatedAt,
      },
      { status: 409 },
    );
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const crossSite = crossSiteRefusal(req);
  if (crossSite) return crossSite;
  return (await documents.remove(userId, (await params).id))
    ? new NextResponse(null, { status: 204 })
    : notFound();
}
