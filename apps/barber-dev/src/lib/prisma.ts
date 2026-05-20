// Custom generator output: see prisma/schema.prisma. We import from the relative
// path instead of `@prisma/client` so this workspace's client doesn't fight with
// the shop backend's client over node_modules/@prisma/client.
import { PrismaClient } from "../../prisma/generated/index.js";
import { isProd } from "./env.js";

export const prisma = new PrismaClient({
  log: isProd ? ["error"] : ["warn", "error"],
});

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

export type { Operator, Shop, FeeCollection, RevenueSnapshot } from "../../prisma/generated/index.js";
