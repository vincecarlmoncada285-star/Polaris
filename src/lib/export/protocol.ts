// GET /api/documents/export, shared by the route and the browser that builds the zip.
import type { DocumentDTO } from "@/lib/documents/service";

export const EXPORT_ENDPOINT = "/api/documents/export";
/** Documents per page: small enough that each response is quick, however long they are. */
export const EXPORT_PAGE_SIZE = 20;
export const EXPORT_PAGE_MAX = 50;

export interface ExportPage {
  documents: DocumentDTO[];
  /** Pass as ?cursor= for the next page; null on the last one. */
  nextCursor: string | null;
  /** How many documents the user has in all. */
  total: number;
}
