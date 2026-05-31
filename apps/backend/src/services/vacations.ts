import { prisma } from "../lib/prisma.js";

/**
 * Returns the set of vacation date-keys ("YYYY-MM-DD" in shop TZ) within
 * [fromKey, toKey] inclusive. The two endpoints are compared as strings —
 * lexicographic order matches calendar order for ISO dates.
 */
export async function vacationDatesInRange(fromKey: string, toKey: string): Promise<Set<string>> {
  const rows = await prisma.vacationDay.findMany({
    where: { date: { gte: fromKey, lte: toKey } },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date));
}

export async function isVacationDay(dateKey: string): Promise<boolean> {
  const row = await prisma.vacationDay.findUnique({ where: { date: dateKey } });
  return !!row;
}
