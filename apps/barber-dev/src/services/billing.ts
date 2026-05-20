import { prisma } from "../lib/prisma.js";
import { currentMonthKey } from "../lib/money.js";

/** Returns (or creates) the FeeCollection row for a shop's current month. */
export async function ensureCurrentFeeRow(shopId: string, amountMinor: number) {
  const monthKey = currentMonthKey();
  return prisma.feeCollection.upsert({
    where: { shopId_monthKey: { shopId, monthKey } },
    update: {}, // keep existing amount/status — admins set it explicitly
    create: { shopId, monthKey, amountMinor, status: "PENDING" },
  });
}

/** Bulk-create PENDING rows for all active shops for the given month. */
export async function ensureFeeRowsForMonth(monthKey: string) {
  const shops = await prisma.shop.findMany({ where: { isActive: true } });
  for (const shop of shops) {
    if (shop.monthlyFeeMinor <= 0) continue;
    await prisma.feeCollection.upsert({
      where: { shopId_monthKey: { shopId: shop.id, monthKey } },
      update: {},
      create: { shopId: shop.id, monthKey, amountMinor: shop.monthlyFeeMinor, status: "PENDING" },
    });
  }
}

export async function markCollected(shopId: string, monthKey?: string, note?: string) {
  const mk = monthKey ?? currentMonthKey();
  return prisma.feeCollection.update({
    where: { shopId_monthKey: { shopId, monthKey: mk } },
    data: { status: "COLLECTED", collectedAt: new Date(), note: note ?? null },
  });
}

export async function pendingForMonth(monthKey: string) {
  return prisma.feeCollection.findMany({
    where: { monthKey, status: "PENDING" },
    include: { shop: true },
    orderBy: { shop: { name: "asc" } },
  });
}

export async function statusForShop(shopId: string, monthKey: string) {
  return prisma.feeCollection.findUnique({ where: { shopId_monthKey: { shopId, monthKey } } });
}
