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
  /** Raised by every update; see `baseVersion` in UpdateDocumentInput. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** What a save returns: enough for the editor to carry on, without echoing the document. */
export type SavedDocument = Pick<DocumentDTO, "id" | "version" | "updatedAt" | "wordCount">;

/**
 * The save named a version the document has moved past: someone (usually the same writer in
 * another tab) saved a newer one. Carries the current version so the editor can explain.
 */
export class DocumentConflictError extends Error {
  constructor(
    readonly version: number,
    readonly updatedAt: string,
  ) {
    super("The document has changed since this version.");
    this.name = "DocumentConflictError";
  }
}

export type DocumentSummary = Pick<DocumentDTO, "id" | "title" | "wordCount" | "updatedAt"> & {
  excerpt: string;
};

/**
 * A document in the data export: its plain text only when its content is not a usable
 * document (the archive's fallback), so a page carries each document's text once.
 */
export type ExportedDocument = Omit<DocumentDTO, "plainText"> & { plainText?: string };

/** Characters of plain text the library shows under each title. */
export const EXCERPT_CHARS = 160;

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
    version: row.version,
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
      // The excerpt is cut in SQL: reading every document's whole plain text to keep 160
      // characters of it cost hundreds of megabytes per library load for long documents.
      const [rows, excerpts] = await Promise.all([
        db.document.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, wordCount: true, updatedAt: true },
        }),
        db.$queryRaw<{ id: string; excerpt: string }[]>`
          SELECT "id", substr("plainText", 1, ${EXCERPT_CHARS}) AS "excerpt" FROM "Document"
          WHERE "userId" = ${userId}`,
      ]);
      const excerptOf = new Map(excerpts.map((e) => [e.id, e.excerpt]));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        wordCount: r.wordCount,
        updatedAt: r.updatedAt.toISOString(),
        excerpt: excerptOf.get(r.id) ?? "",
      }));
    },

    /** How many documents the user has, and their stored characters (content + plain text). */
    /**
     * How many documents the user has and how many characters they store (content and plain
     * text). With `exceptId`, that document's characters are left out of `chars`, for a save
     * that is about to replace them.
     */
    async usage(userId: string, exceptId?: string): Promise<{ documents: number; chars: number }> {
      const [row] = await db.$queryRaw<
        { documents: number | bigint; chars: number | bigint | null }[]
      >`SELECT count(*) AS "documents",
          sum(CASE WHEN "id" = ${exceptId ?? null} THEN 0
              ELSE length("content") + length("plainText") END) AS "chars"
        FROM "Document" WHERE "userId" = ${userId}`;
      return { documents: Number(row?.documents ?? 0), chars: Number(row?.chars ?? 0) };
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

    /**
     * Applies a save. Null if the user has no such document. With `baseVersion`, the write
     * only happens if the document is still at that version (checked in the UPDATE itself),
     * otherwise DocumentConflictError. Every update raises the version.
     */
    async update(
      userId: string,
      id: string,
      input: UpdateDocumentInput,
    ): Promise<SavedDocument | null> {
      const data: Record<string, unknown> = { version: { increment: 1 } };
      if (input.title !== undefined) data.title = input.title || "Untitled document";
      if (input.content !== undefined) data.content = JSON.stringify(input.content);
      if (input.plainText !== undefined) {
        data.plainText = input.plainText;
        data.wordCount = countWords(input.plainText);
      }
      if (input.goals !== undefined) data.goals = JSON.stringify(input.goals);
      const where =
        input.baseVersion === undefined
          ? { id, userId }
          : { id, userId, version: input.baseVersion };
      const { count } = await db.document.updateMany({ where, data });
      const row = await db.document.findFirst({
        where: { id, userId },
        select: { id: true, version: true, updatedAt: true, wordCount: true },
      });
      if (!row) return null;
      if (count === 0) throw new DocumentConflictError(row.version, row.updatedAt.toISOString());
      return { ...row, updatedAt: row.updatedAt.toISOString() };
    },

    /** The version and save time only, for an editor checking whether it is out of date. */
    async version(
      userId: string,
      id: string,
    ): Promise<Pick<DocumentDTO, "version" | "updatedAt"> | null> {
      const row = await db.document.findFirst({
        where: { id, userId },
        select: { version: true, updatedAt: true },
      });
      return row ? { version: row.version, updatedAt: row.updatedAt.toISOString() } : null;
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
