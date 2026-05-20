import { prisma } from "../lib/prisma.js";

export async function listShops() {
  return prisma.shop.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
}

export async function findShopBySlug(slug: string) {
  return prisma.shop.findUnique({ where: { slug } });
}

export interface ShopCreateInput {
  slug: string;
  name: string;
  ownerTelegramId: bigint;
  dbUrl?: string;
  botUsername?: string;
}

export async function createShop(input: ShopCreateInput) {
  return prisma.shop.create({
    data: {
      slug: input.slug,
      name: input.name,
      ownerTelegramId: input.ownerTelegramId,
      dbUrl: input.dbUrl,
      botUsername: input.botUsername,
    },
  });
}

export async function setShopFee(slug: string, amountMinor: number) {
  return prisma.shop.update({ where: { slug }, data: { monthlyFeeMinor: amountMinor } });
}

export async function setShopActive(slug: string, isActive: boolean) {
  return prisma.shop.update({ where: { slug }, data: { isActive } });
}

export async function setShopDbUrl(slug: string, dbUrl: string | null) {
  return prisma.shop.update({ where: { slug }, data: { dbUrl } });
}

/**
 * Updates the *cached* apprentice feature flag in the control DB. The caller is
 * responsible for also pushing the change into the shop's own Settings table via
 * setShopApprenticeFeature() in shop-db.ts.
 */
export async function setControlApprentice(slug: string, enabled: boolean) {
  return prisma.shop.update({ where: { slug }, data: { hasApprenticeFeature: enabled } });
}

export async function setControlLocation(slug: string, location: string | null) {
  return prisma.shop.update({ where: { slug }, data: { location } });
}
