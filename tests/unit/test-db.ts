import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/** A fresh SQLite database with the current schema, in its own temp directory. */
export function createTestDb(): { db: PrismaClient; cleanup: () => Promise<void> } {
  const dir = mkdtempSync(path.join(tmpdir(), "polaris-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  const db = new PrismaClient({ datasourceUrl: url });
  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
