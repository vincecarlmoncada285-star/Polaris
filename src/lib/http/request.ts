import { NextResponse } from "next/server";

/**
 * Request bodies, read safely. Next.js puts no size limit on route handlers, and
 * `req.json()` buffers whatever arrives, so a single large request could exhaust the server's
 * memory. Every JSON route reads its body through here instead, with a cap that fits what it
 * accepts.
 */

/** Bodies of a few small fields: settings, passwords, sign-in forms. */
export const SMALL_BODY_BYTES = 16 * 1024;

type BodyRead = { ok: true; text: string } | { ok: false; status: 400 | 413 };

/**
 * The request body as text, never holding more than `maxBytes` of it: a declared
 * Content-Length over the cap is refused unread, and a body without one (chunked) is cut off
 * as soon as it passes the cap.
 */
export async function readBody(req: Request, maxBytes: number): Promise<BodyRead> {
  if (Number(req.headers.get("content-length")) > maxBytes) return { ok: false, status: 413 };
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { ok: true, text: text + decoder.decode() };
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return { ok: false, status: 400 };
  }
}

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export type JsonRead = { ok: true; value: unknown } | { ok: false; response: NextResponse };

/**
 * A JSON request body under `maxBytes`. Only `Content-Type: application/json` is accepted: an
 * HTML form cannot send that type, so a page on another site (even one on the same site, such
 * as another student's pages on a university domain, where SameSite=Lax cookies still go)
 * cannot post a form that reads as JSON.
 */
export async function readJson(
  req: Request,
  maxBytes: number,
  tooLarge = "This request is too large.",
): Promise<JsonRead> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(?:;|$)/i.test(type)) {
    return { ok: false, response: json(415, "Send the request as JSON.") };
  }
  const read = await readBody(req, maxBytes);
  if (!read.ok) {
    return {
      ok: false,
      response:
        read.status === 413 ? json(413, tooLarge) : json(400, "Could not read the request."),
    };
  }
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch {
    return { ok: false, response: json(400, "The request is not valid JSON.") };
  }
}

/**
 * Refuses a state-changing request a browser says came from another origin. Browsers send
 * `Sec-Fetch-Site` on every request; Polaris's own pages send `same-origin`. A missing header
 * (curl, scripts, the e2e tests' API client) is allowed: it carries no ambient cookie the
 * caller did not choose to send.
 */
export function crossSiteRefusal(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return json(403, "Requests from other sites are not accepted.");
  }
  return null;
}
