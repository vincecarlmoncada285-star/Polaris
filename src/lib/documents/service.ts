import type { Prisma, PrismaClient } from "@prisma/client";
import { countWords } from "@/lib/text/stats";
import type { CreateDocumentInput, UpdateDocumentInput, WritingGoals } from "./schema";

export interface DocumentDTO {
  id: string;
  title: string;
  content: unknown;
  plainText: string;
  wordCount: number;
  goals: WritingGoals;
  createdAt: string;
  updatedAt: string;
}

export type DocumentSummary = Pick<DocumentDTO, "id" | "title" | "wordCount" | "updatedAt"> & {
  excerpt: string;
};

/**
 * A document in the data export: its plain text only when its content is not a usable
 * document (the archive's fallback), so a page carries each document's text once.
 */
export type ExportedDocument = Omit<DocumentDTO, "plainText"> & { plainText?: string };

const isDocContent = (content: unknown) =>
  typeof content === "object" && content !== null && (content as { type?: unknown }).type === "doc";

type Row = Awaited<ReturnType<PrismaClient["document"]["findFirstOrThrow"]>>;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toDTO(row: Row): DocumentDTO {
  return {
    id: row.id,
    title: row.title,
    content: parseJson(row.content, null),
    plainText: row.plainText,
    wordCount: row.wordCount,
    goals: parseJson<WritingGoals>(row.goals, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Every method is scoped to one user. Another user's document is indistinguishable from a
// missing one (null / false), and writes put `userId` in the WHERE clause itself, so there is
// no window between an ownership check and the write.
export function createDocumentService(db: PrismaClient) {
  return {
    async list(userId: string): Promise<DocumentSummary[]> {
      const rows = await db.document.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, wordCount: true, updatedAt: true, plainText: true },
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        wordCount: r.wordCount,
        updatedAt: r.updatedAt.toISOString(),
        excerpt: r.plainText.slice(0, 160),
      }));
    },

    async get(userId: string, id: string): Promise<DocumentDTO | null> {
      const row = await db.document.findFirst({ where: { id, userId } });
      return row ? toDTO(row) : null;
    },

    /** A new document: empty, or with the title, content and plain text an import made. */
    async create(userId: string, input: CreateDocumentInput = {}): Promise<DocumentDTO> {
      const data: Prisma.DocumentUncheckedCreateInput = { userId };
      if (input.title) data.title = input.title;
      if (input.content !== undefined) data.content = JSON.stringify(input.content);
      if (input.plainText !== undefined) {
        data.plainText = input.plainText;
        data.wordCount = countWords(input.plainText);
      }
      const row = await db.document.create({ data });
      return toDTO(row);
    },

    async update(
      userId: string,
      id: string,
      input: UpdateDocumentInput,
    ): Promise<DocumentDTO | null> {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title || "Untitled document";
      if (input.content !== undefined) data.content = JSON.stringify(input.content);
      if (input.plainText !== undefined) {
        data.plainText = input.plainText;
        data.wordCount = countWords(input.plainText);
      }
      if (input.goals !== undefined) data.goals = JSON.stringify(input.goals);
      const { count } = await db.document.updateMany({ where: { id, userId }, data });
      if (count === 0) return null;
      const row = await db.document.findFirst({ where: { id, userId } });
      return row ? toDTO(row) : null;
    },

    /**
     * One page of the user's documents with their content, for the data export: ordered by id,
     * starting after `after`, at most `take` of them and, after the first, no more than
     * `maxChars` characters of stored content and plain text in all (one long document fills a
     * page alone). Paging keeps each response small however many documents there are and
     * however long they are; the next page starts after the last id of this one.
     */
    async exportPage(
      userId: string,
      { after, take, maxChars }: { after?: string; take: number; maxChars: number },
    ): Promise<{ documents: ExportedDocument[]; nextCursor: string | null; total: number }> {
      // Sizes first, so only what fits in the page is read.
      const [sizes, total] = await Promise.all([
        db.$queryRaw<{ id: string; size: number | bigint }[]>`
          SELECT "id", length("content") + length("plainText") AS "size" FROM "Document"
          WHERE "userId" = ${userId} AND "id" > ${after ?? ""}
          ORDER BY "id" ASC LIMIT ${take + 1}`,
        db.document.count({ where: { userId } }),
      ]);
      const ids: string[] = [];
      let chars = 0;
      for (const { id, size } of sizes.slice(0, take)) {
        if (ids.length > 0 && chars + Number(size) > maxChars) break;
        ids.push(id);
        chars += Number(size);
      }
      const rows = ids.length
        ? await db.document.findMany({ where: { userId, id: { in: ids } }, orderBy: { id: "asc" } })
        : [];
      return {
        documents: rows.map((row) => {
          const { plainText, ...doc } = toDTO(row);
          return isDocContent(doc.content) ? doc : { ...doc, plainText };
        }),
        nextCursor: sizes.length > ids.length ? (ids.at(-1) ?? null) : null,
        total,
      };
    },

    async remove(userId: string, id: string): Promise<boolean> {
      const { count } = await db.document.deleteMany({ where: { id, userId } });
      return count > 0;
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
