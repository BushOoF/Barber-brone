/**
 * Resolve the Barber row for an admin Telegram user. The seed inserts admins by
 * telegramId; we look them up here. If an allow-listed admin somehow has no row
 * yet (e.g. seed not run for a freshly added id), we lazily create one so the
 * bot keeps working.
 */
import type { Barber } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isAdmin } from "../env.js";

export async function resolveBarber(telegramId: number): Promise<Barber | null> {
  if (!isAdmin(telegramId)) return null;
  const id = BigInt(telegramId);
  const existing = await prisma.barber.findUnique({ where: { telegramId: id } });
  if (existing) return existing;
  return prisma.barber.create({ data: { telegramId: id, name: "Barber" } });
}
