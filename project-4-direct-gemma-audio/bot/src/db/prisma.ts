/**
 * Single shared PrismaClient instance for the whole process.
 * Importing this module more than once still yields one client.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

/** Close the DB connection cleanly on shutdown. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
