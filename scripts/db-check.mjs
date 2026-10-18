// `npm run db:check`: fails when prisma/schema.prisma and prisma/migrations disagree, that is,
// when the schema was changed without a migration (or a migration without the schema). Prisma
// replays the migrations into a throwaway SQLite "shadow" database to compare them, so this
// never touches a real database.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const prisma = createRequire(import.meta.url).resolve("prisma/build/index.js");
const dir = mkdtempSync(path.join(tmpdir(), "polaris-db-check-"));

let status;
try {
  const result = spawnSync(
    process.execPath,
    [
      prisma,
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--shadow-database-url",
      `file:${path.join(dir, "shadow.db")}`,
      "--exit-code",
    ],
    {
      stdio: "inherit",
      // The schema names env("DATABASE_URL"); diffing never connects to it, but Prisma wants it
      // set (CI has no .env).
      env: { DATABASE_URL: `file:${path.join(dir, "unused.db")}`, ...process.env },
    },
  );
  status = result.status;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// prisma migrate diff --exit-code: 0 = the same, 2 = they differ, anything else = an error.
if (status === 0) {
  console.log("db:check: prisma/migrations matches prisma/schema.prisma.");
} else if (status === 2) {
  console.error(
    "db:check: prisma/schema.prisma has changes that no migration makes (the difference is above).\n" +
      "Add a migration: mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name> and run\n" +
      "  npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \\\n" +
      "    --shadow-database-url file:./shadow.db --script > prisma/migrations/<that folder>/migration.sql",
  );
  process.exit(1);
} else {
  console.error("db:check: could not compare the schema with the migrations.");
  process.exit(1);
}
