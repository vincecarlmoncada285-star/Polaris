import { NextResponse } from "next/server";
import { documents } from "@/lib/documents";
import { createDocumentSchema } from "@/lib/documents/schema";

export async function GET() {
  return NextResponse.json(await documents.list());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createDocumentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await documents.create(parsed.data), { status: 201 });
}
