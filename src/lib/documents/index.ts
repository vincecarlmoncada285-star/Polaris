import { prisma } from "@/lib/db";
import { createDocumentService } from "./service";

export const documents = createDocumentService(prisma);
