import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { createDocumentSchema } from "@/lib/documents/schema";
import { DOCUMENT_BODY_BYTES, refuseCreate } from "@/lib/documents/writes";
import { crossSiteRefusal, readJson } from "@/lib/http/request";

export async function GET() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json(await documents.list(userId));
}

export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const crossSite = crossSiteRefusal(req);
  if (crossSite) return crossSite;
  const body = await readJson(req, DOCUMENT_BODY_BYTES, "This document is too large.");
  if (!body.ok) return body.response;
  const parsed = createDocumentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const refused = await refuseCreate(userId, parsed.data);
  if (refused) return refused;
  return NextResponse.json(await documents.create(userId, parsed.data), { status: 201 });
}
