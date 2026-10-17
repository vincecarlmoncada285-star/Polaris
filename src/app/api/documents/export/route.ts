import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { exportLimiter } from "@/lib/documents/limits";
import {
  EXPORT_PAGE_CHARS,
  EXPORT_PAGE_MAX,
  EXPORT_PAGE_SIZE,
  type ExportPage,
} from "@/lib/export/protocol";

const querySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(EXPORT_PAGE_MAX).default(EXPORT_PAGE_SIZE),
});

/**
 * The signed-in user's documents with their content, a page at a time, for "Download all my
 * documents" in Settings (the zip is made in the browser). Only ever their own documents: the
 * query is scoped by user, and a cursor from anyone else's list only says where to start.
 * Each page is bounded in size as well as in count, and pages are rate limited per user.
 */
export async function GET(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const rate = exportLimiter.hit(userId);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many export requests. Please try again later.", code: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) },
      },
    );
  }
  const params = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const page = await documents.exportPage(userId, {
    after: parsed.data.cursor,
    take: parsed.data.limit,
    maxChars: EXPORT_PAGE_CHARS,
  });
  return NextResponse.json(page satisfies ExportPage, { headers: { "Cache-Control": "no-store" } });
}
