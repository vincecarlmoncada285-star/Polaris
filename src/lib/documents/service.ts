import type { PrismaClient } from "@prisma/client";
import { countWords } from "@/lib/text/stats";
import type { UpdateDocumentInput, WritingGoals } from "./schema";

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

export function createDocumentService(db: PrismaClient) {
  return {
    async list(): Promise<DocumentSummary[]> {
      const rows = await db.document.findMany({
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

    async get(id: string): Promise<DocumentDTO | null> {
      const row = await db.document.findUnique({ where: { id } });
      return row ? toDTO(row) : null;
    },

    async create(input: { title?: string } = {}): Promise<DocumentDTO> {
      const row = await db.document.create({
        data: input.title ? { title: input.title } : {},
      });
      return toDTO(row);
    },

    async update(id: string, input: UpdateDocumentInput): Promise<DocumentDTO | null> {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title || "Untitled document";
      if (input.content !== undefined) data.content = JSON.stringify(input.content);
      if (input.plainText !== undefined) {
        data.plainText = input.plainText;
        data.wordCount = countWords(input.plainText);
      }
      if (input.goals !== undefined) data.goals = JSON.stringify(input.goals);
      try {
        return toDTO(await db.document.update({ where: { id }, data }));
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async remove(id: string): Promise<boolean> {
      try {
        await db.document.delete({ where: { id } });
        return true;
      } catch (e) {
        if (isNotFound(e)) return false;
        throw e;
      }
    },
  };
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2025";
}

export type DocumentService = ReturnType<typeof createDocumentService>;
