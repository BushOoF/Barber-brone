import { prisma } from "../lib/prisma.js";
import { getShopRevenue } from "../lib/shop-db.js";
import { currentMonthKey } from "../lib/money.js";

const CACHE_TTL_MS = 5 * 60_000; // 5 min — revenue rarely changes minute-to-minute

interface RevenueResult {
  revenueMinor: number;
  bookingsCount: number;
  noShows: number;
  fromCache: boolean;
}

/**
 * Look up monthly revenue for a shop. Hits the cache (RevenueSnapshot) if it's
 * recent, otherwise opens a short-lived pg connection to the shop's DB and
 * refreshes the snapshot.
 */
export async function getMonthlyRevenue(shopId: string, dbUrl: string | null, monthKey?: string): Promise<RevenueResult | null> {
  if (!dbUrl) return null;
  const mk = monthKey ?? currentMonthKey();
  const cached = await prisma.revenueSnapshot.findUnique({ where: { shopId_monthKey: { shopId, monthKey: mk } } });
  if (cached && Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS) {
    return {
      revenueMinor: cached.revenueMinor,
      bookingsCount: cached.bookingsCount,
      noShows: 0, // not cached — rare to need; ok to read 0 from cache
      fromCache: true,
    };
  }
  let fresh;
  try {
    fresh = await getShopRevenue(dbUrl, mk);
  } catch (err) {
    console.error(`[revenue] failed to query ${dbUrl}:`, err);
    return null;
  }
  await prisma.revenueSnapshot.upsert({
    where: { shopId_monthKey: { shopId, monthKey: mk } },
    update: { revenueMinor: fresh.revenueMinor, bookingsCount: fresh.bookingsCount, cachedAt: new Date() },
    create: { shopId, monthKey: mk, revenueMinor: fresh.revenueMinor, bookingsCount: fresh.bookingsCount },
  });
  return { ...fresh, fromCache: false };
}
