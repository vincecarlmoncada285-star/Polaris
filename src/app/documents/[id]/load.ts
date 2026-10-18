import { cache } from "react";
import { documents } from "@/lib/documents";

/**
 * The document for this request, loaded once and shared by the layout, the metadata and the
 * page. Scoped to the user like every document read: someone else's document is null, exactly
 * like one that does not exist.
 */
export const loadDocument = cache((userId: string, id: string) => documents.get(userId, id));
