import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { readBody, SMALL_BODY_BYTES } from "@/lib/http/request";

export const { GET } = handlers;

/**
 * Auth.js reads the whole POST body (sign-in, sign-out, session update) before it checks
 * anything, even the CSRF token, and these endpoints need no account. So the body is read here
 * first, under a small cap: a sign-in form is a few hundred bytes, and a huge body is refused
 * before it can use up the server's memory.
 */
export async function POST(req: NextRequest) {
  const read = await readBody(req, SMALL_BODY_BYTES);
  if (!read.ok) return new Response(null, { status: read.status });
  return handlers.POST(
    new NextRequest(req.url, { method: "POST", headers: req.headers, body: read.text }),
  );
}
