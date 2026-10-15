import { NextResponse } from "next/server";
import { documents } from "@/lib/documents";
import { updateDocumentSchema } from "@/lib/documents/schema";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const doc = await documents.get((await params).id);
  return doc ? NextResponse.json(doc) : notFound();
}

export async function PATCH(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => null);
  const parsed = updateDocumentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const doc = await documents.update((await params).id, parsed.data);
  return doc ? NextResponse.json(doc) : notFound();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return (await documents.remove((await params).id))
    ? new NextResponse(null, { status: 204 })
    : notFound();
}
