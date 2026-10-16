// Structured outputs, read defensively: shared by the paragraph and review requests.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod/v4";

/**
 * The structured-output format for `schema`, with a parse that returns null instead of
 * throwing. The SDK runs it over every text block before a response is handed back, and a
 * refusal, or a server-side fallback hop (which keeps the declining model's partial text),
 * usually carries text that is not schema JSON: a throwing parse would turn those into errors
 * before stop_reason is read. Only the schema is sent; the parse function stays here.
 */
export function lenientOutputFormat<Schema extends z.ZodType>(schema: Schema) {
  const strict = betaZodOutputFormat(schema);
  return {
    ...strict,
    parse(content: string): z.infer<Schema> | null {
      try {
        return strict.parse(content);
      } catch {
        return null;
      }
    },
  };
}

/**
 * The output in a finished answer: the text after the last `fallback` block (before it is the
 * output of a model that declined), checked against `schema`. Null if it does not parse.
 */
export function outputFromContent<Schema extends z.ZodType>(
  content: ReadonlyArray<{ type: string; text?: string }>,
  schema: Schema,
): z.infer<Schema> | null {
  let start = 0;
  content.forEach((block, i) => {
    if (block.type === "fallback") start = i + 1;
  });
  const text = content
    .slice(start)
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
  if (!text.trim()) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Claude answered, but not with usable output. */
export class AiOutputError extends Error {
  constructor(readonly reason: "max_tokens" | "unparseable") {
    super(`Unusable model output (${reason})`);
    this.name = "AiOutputError";
  }
}
