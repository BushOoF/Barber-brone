/**
 * Cross-database access to a barber-brone *shop*'s Postgres instance.
 *
 * We use the raw `pg` client (not Prisma) here because:
 *  - We don't need ORM models for the few read/write queries we issue.
 *  - It lets us connect to many databases at runtime using their stored dbUrl.
 *  - Avoids generating Prisma client bundles for every shop.
 *
 * Each call opens a short-lived connection, runs the query, and closes — fine for
 * the operator bot's low query volume. If usage grows, swap to a connection-pool
 * cache keyed by dbUrl.
 */
import { Client } from "pg";

async function withClient<T>(dbUrl: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrl, statement_timeout: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function getShopRevenue(dbUrl: string, monthKey: string): Promise<{ revenueMinor: number; bookingsCount: number; noShows: number }> {
  // monthKey like "2026-05" — derive UTC range [first-of-month, first-of-next-month)
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return withClient(dbUrl, async (c) => {
    const res = await c.query<{
      revenue: string | null;
      total: string;
      noshows: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('SCHEDULED','COMPLETED') THEN "totalPriceMinor" ELSE 0 END), 0)::text AS revenue,
         COUNT(*) FILTER (WHERE status <> 'DISCARDED_NO_SHOW')::text AS total,
         COUNT(*) FILTER (WHERE status = 'DISCARDED_NO_SHOW')::text AS noshows
       FROM "Booking"
       WHERE "startAt" >= $1 AND "startAt" < $2`,
      [start, end],
    );
    const row = res.rows[0];
    return {
      revenueMinor: Number(row?.revenue ?? 0),
      bookingsCount: Number(row?.total ?? 0),
      noShows: Number(row?.noshows ?? 0),
    };
  });
}

export async function setShopApprenticeFeature(dbUrl: string, enabled: boolean): Promise<void> {
  await withClient(dbUrl, async (c) => {
    await c.query(
      `UPDATE "Settings" SET "hasApprenticeFeature" = $1, "updatedAt" = NOW() WHERE id = 'singleton'`,
      [enabled],
    );
  });
}

export async function setShopVoiceFeature(dbUrl: string, enabled: boolean): Promise<void> {
  await withClient(dbUrl, async (c) => {
    await c.query(
      `UPDATE "Settings" SET "hasVoiceFeature" = $1, "updatedAt" = NOW() WHERE id = 'singleton'`,
      [enabled],
    );
  });
}

export async function setShopLocation(dbUrl: string, location: string | null): Promise<void> {
  await withClient(dbUrl, async (c) => {
    await c.query(
      `UPDATE "Settings" SET "location" = $1, "updatedAt" = NOW() WHERE id = 'singleton'`,
      [location],
    );
  });
}

export async function getShopSnapshot(dbUrl: string): Promise<{ shopName: string; currency: string; location: string | null; hasApprenticeFeature: boolean } | null> {
  return withClient(dbUrl, async (c) => {
    const res = await c.query<{
      shopName: string;
      currency: string;
      location: string | null;
      hasApprenticeFeature: boolean;
    }>(
      `SELECT "shopName", "currency", "location", "hasApprenticeFeature"
         FROM "Settings" WHERE id = 'singleton' LIMIT 1`,
    );
    return res.rows[0] ?? null;
  });
}
