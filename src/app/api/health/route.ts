import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// For load balancers, uptime checks and Docker's HEALTHCHECK: no session, no rate limit, and
// nothing in the answer but whether Polaris can reach its database.
export const dynamic = "force-dynamic";

/** How long the database may take to answer before the check counts as failed. */
const HEALTH_TIMEOUT_MS = 3000;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    // A fixed label: the error itself (paths, engine messages) stays out of logs and responses.
    console.error("Health check: the database did not answer");
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
