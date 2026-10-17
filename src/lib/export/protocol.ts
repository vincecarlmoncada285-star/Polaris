// GET /api/documents/export, shared by the route and the browser that builds the zip.
import type { ExportedDocument } from "@/lib/documents/service";

export type { ExportedDocument } from "@/lib/documents/service";

export const EXPORT_ENDPOINT = "/api/documents/export";
/** Documents per page: small enough that each response is quick. */
export const EXPORT_PAGE_SIZE = 20;
/** The most a page may be asked for: what the browser asks for. */
export const EXPORT_PAGE_MAX = EXPORT_PAGE_SIZE;
/**
 * Characters of stored content and plain text a page stops at (one document longer than this
 * comes on a page of its own), so a page of long documents is not hundreds of megabytes.
 */
export const EXPORT_PAGE_CHARS = 8_000_000;

export interface ExportPage {
  documents: ExportedDocument[];
  /** Pass as ?cursor= for the next page; null on the last one. */
  nextCursor: string | null;
  /** How many documents the user has in all. */
  total: number;
}
