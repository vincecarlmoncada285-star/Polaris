import { prisma } from "@/lib/db";
import { createUserService } from "./service";

export const users = createUserService(prisma);
