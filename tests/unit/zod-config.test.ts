import { describe, expect, it } from "vitest";
import { z } from "zod";
import { writingGoalsSchema } from "@/lib/documents/schema";

describe("zod configuration", () => {
  it("is jitless wherever a schema is loaded, so the browser never probes eval", () => {
    // Loading any schema module loads src/lib/zod.ts first.
    expect(writingGoalsSchema.safeParse({}).success).toBe(true);
    expect(z.config().jitless).toBe(true);
  });
});
