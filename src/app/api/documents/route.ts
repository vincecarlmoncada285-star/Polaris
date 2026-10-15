import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { createDocumentSchema } from "@/lib/documents/schema";

export async function GET() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json(await documents.list(userId));
}

export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const body = await req.json().catch(() => ({}));
  const parsed = createDocumentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await documents.create(userId, parsed.data), { status: 201 });
}
