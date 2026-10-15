import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { updateDocumentSchema } from "@/lib/documents/schema";

type Ctx = { params: Promise<{ id: string }> };

// Also the answer for another user's document: a 403 would confirm that the id exists.
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const doc = await documents.get(userId, (await params).id);
  return doc ? NextResponse.json(doc) : notFound();
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const body = await req.json().catch(() => null);
  const parsed = updateDocumentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const doc = await documents.update(userId, (await params).id, parsed.data);
  return doc ? NextResponse.json(doc) : notFound();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  return (await documents.remove(userId, (await params).id))
    ? new NextResponse(null, { status: 204 })
    : notFound();
}
