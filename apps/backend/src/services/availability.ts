import type { Booking, TimeBlock } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { addMinutes, localDateKey, localDateTimeToUtc, localDayBoundsUtc, todayKey } from "../lib/time.js";
import { isVacationDay } from "./vacations.js";

export interface Slot {
  startAt: Date;
  endAt: Date;
}

interface DayContextLite {
  openUtc: Date;
  closeUtc: Date;
  occupied: { startAt: Date; endAt: Date }[];
}

async function getOccupiedDay(barberId: string, dateKey: string): Promise<DayContextLite> {
  const { start, end } = localDayBoundsUtc(dateKey);
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const openMin = settings?.openHourMin ?? 540;
  const closeMin = settings?.closeHourMin ?? 1260;
  const openUtc = localDateTimeToUtc(dateKey, openMin);
  const closeUtc = localDateTimeToUtc(dateKey, closeMin);

  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: { barberId, status: "SCHEDULED", startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true },
    }),
    prisma.timeBlock.findMany({
      where: { barberId, startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const occupied = [...bookings, ...blocks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return { openUtc, closeUtc, occupied };
}

/**
 * Find the next slot of `durationMin` minutes for a barber, starting from `from` (defaults to now).
 * Returns null if no slot fits before closing time.
 */
export async function findNextSlot(barberId: string, durationMin: number, from: Date = new Date()): Promise<Slot | null> {
  // Search across today + next 6 days.
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dateKey = offsetDateKey(from, dayOffset);
    // Shop closed for the day → skip entirely.
    if (await isVacationDay(dateKey)) continue;
    const { openUtc, closeUtc, occupied } = await getOccupiedDay(barberId, dateKey);

    let cursor = dayOffset === 0 ? new Date(Math.max(from.getTime(), openUtc.getTime())) : openUtc;
    // Round cursor up to the next 5-minute boundary for clean times.
    cursor = roundUpTo5(cursor);

    for (const occ of occupied) {
      if (cursor.getTime() + durationMin * 60_000 <= occ.startAt.getTime()) {
        // Fits before this occupied window.
        const end = addMinutes(cursor, durationMin);
        if (end <= closeUtc) return { startAt: cursor, endAt: end };
      }
      if (occ.endAt > cursor) cursor = occ.endAt;
    }
    // Try after the last occupied window.
    cursor = roundUpTo5(cursor);
    const end = addMinutes(cursor, durationMin);
    if (end <= closeUtc) return { startAt: cursor, endAt: end };
  }
  return null;
}

/** Return all valid start-times (every 15 minutes) for the given day that can fit `durationMin`. */
export async function getDaySlots(barberId: string, dateKey: string, durationMin: number, step = 15): Promise<Slot[]> {
  if (await isVacationDay(dateKey)) return [];
  const { openUtc, closeUtc, occupied } = await getOccupiedDay(barberId, dateKey);
  const slots: Slot[] = [];
  const now = new Date();
  const startBase = dateKey === todayKey() ? new Date(Math.max(now.getTime(), openUtc.getTime())) : openUtc;
  let t = roundUpTo(startBase, step);
  while (addMinutes(t, durationMin) <= closeUtc) {
    const end = addMinutes(t, durationMin);
    const conflicts = occupied.some((o) => o.startAt < end && o.endAt > t);
    if (!conflicts) slots.push({ startAt: t, endAt: end });
    t = addMinutes(t, step);
  }
  return slots;
}

function offsetDateKey(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60_000);
  return localDateKey(d);
}

function roundUpTo5(d: Date): Date {
  return roundUpTo(d, 5);
}

function roundUpTo(d: Date, minutes: number): Date {
  const ms = minutes * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

/** Check whether a specific window is bookable (no overlap with bookings/blocks, within hours, not a vacation day). */
export async function isSlotAvailable(barberId: string, startAt: Date, durationMin: number): Promise<boolean> {
  const endAt = addMinutes(startAt, durationMin);
  const dateKey = localDateKey(startAt);
  if (await isVacationDay(dateKey)) return false;
  const { openUtc, closeUtc, occupied } = await getOccupiedDay(barberId, dateKey);
  if (startAt < openUtc || endAt > closeUtc) return false;
  return !occupied.some((o) => o.startAt < endAt && o.endAt > startAt);
}
