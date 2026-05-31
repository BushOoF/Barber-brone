/**
 * Single shared PrismaClient instance for the process.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

/** Graceful shutdown helper. */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
