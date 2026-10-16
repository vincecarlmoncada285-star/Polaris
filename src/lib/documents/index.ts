import { prisma } from "@/lib/db";
import { createReviewService } from "./reviews";
import { createDocumentService } from "./service";

export const documents = createDocumentService(prisma);
export const reviews = createReviewService(prisma);
