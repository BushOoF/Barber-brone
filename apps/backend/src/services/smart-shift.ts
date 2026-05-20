import type { Booking, TimeBlock } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  addMinutes,
  localDateKey,
  localDateTimeToUtc,
  localDayBoundsUtc,
} from "../lib/time.js";

export interface ShiftMove {
  bookingId: string;
  oldStart: Date;
  oldEnd: Date;
  newStart: Date;
  newEnd: Date;
  durationMin: number;
}

export interface ShiftLaterPlan {
  moves: ShiftMove[];
  unplaceable: { bookingId: string; reason: "after_close" }[];
}

interface DayContext {
  openUtc: Date;
  closeUtc: Date;
  bookings: Booking[];
  blocks: TimeBlock[];
}

async function getDayContext(barberId: string, anchor: Date): Promise<DayContext> {
  const dateKey = localDateKey(anchor);
  const { start, end } = localDayBoundsUtc(dateKey);
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const openMin = settings?.openHourMin ?? 540;
  const closeMin = settings?.closeHourMin ?? 1260;
  const openUtc = localDateTimeToUtc(dateKey, openMin);
  const closeUtc = localDateTimeToUtc(dateKey, closeMin);

  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        barberId,
        status: "SCHEDULED",
        startAt: { gte: start, lt: end },
      },
      orderBy: { startAt: "asc" },
    }),
    prisma.timeBlock.findMany({
      where: { barberId, startAt: { gte: start, lt: end } },
      orderBy: { startAt: "asc" },
    }),
  ]);

  return { openUtc, closeUtc, bookings, blocks };
}

interface Interval {
  startAt: Date;
  endAt: Date;
}

/**
 * Push `candidate` forward past every obstacle in `intervals` that overlaps
 * [candidate, candidate + durationMs). Iterates until stable.
 */
function pushPastBlocks(candidate: Date, durationMin: number, intervals: Interval[]): { start: Date; end: Date } {
  let start = candidate;
  let end = addMinutes(start, durationMin);
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const iv of intervals) {
      if (iv.startAt < end && iv.endAt > start) {
        start = iv.endAt;
        end = addMinutes(start, durationMin);
        advanced = true;
      }
    }
  }
  return { start, end };
}

/**
 * After a booking is discarded as a no-show, compute new positions for every
 * back-to-back subsequent booking so they slide as early as possible.
 *
 * Critically: the cascade stops at the first "natural gap" in the original
 * schedule (i.e. when the next booking was originally more than
 * GAP_THRESHOLD_MIN minutes after the previous one's end). So if the freed
 * slot was at 09:40 and there's another booking at 20:00 with empty time in
 * between, the 20:00 booking does NOT move — only contiguous clients shift.
 */
const GAP_THRESHOLD_MIN = 30;

export async function planShiftEarlier(
  barberId: string,
  freedStartUtc: Date,
  freedEndUtc: Date,
): Promise<ShiftMove[]> {
  const { openUtc, bookings, blocks } = await getDayContext(barberId, freedStartUtc);

  const subsequent = bookings.filter((b) => b.startAt.getTime() > freedStartUtc.getTime());
  if (subsequent.length === 0) return [];

  // Earliest time the next booking could begin: shop open, but not before the freed slot started.
  let cursor = new Date(Math.max(openUtc.getTime(), freedStartUtc.getTime()));
  // For the gap check we walk the *original* schedule. Seed with the freed slot's original endAt
  // so the first subsequent booking is judged against where the discarded one used to end.
  let prevOriginalEnd = freedEndUtc;

  const moves: ShiftMove[] = [];
  for (const bk of subsequent) {
    const originalGapMin = (bk.startAt.getTime() - prevOriginalEnd.getTime()) / 60_000;
    if (originalGapMin > GAP_THRESHOLD_MIN) {
      // This booking is on the far side of a real schedule gap — stop the cascade.
      break;
    }
    const placed = pushPastBlocks(cursor, bk.durationMin, blocks);
    if (placed.start >= bk.startAt) {
      // No improvement available (a TimeBlock blocks earlier, or already optimal).
      cursor = bk.endAt;
      prevOriginalEnd = bk.endAt;
      continue;
    }
    moves.push({
      bookingId: bk.id,
      oldStart: bk.startAt,
      oldEnd: bk.endAt,
      newStart: placed.start,
      newEnd: placed.end,
      durationMin: bk.durationMin,
    });
    cursor = placed.end;
    prevOriginalEnd = bk.endAt;
  }
  return moves;
}

/**
 * When inserting a new block (break or walk-in), compute new positions for every
 * SCHEDULED booking that overlaps or starts after the block, sliding each later.
 */
export async function planShiftLater(
  barberId: string,
  newBlockStartUtc: Date,
  newBlockEndUtc: Date,
): Promise<ShiftLaterPlan> {
  const { closeUtc, bookings, blocks } = await getDayContext(barberId, newBlockStartUtc);

  const affected = bookings.filter((b) => b.endAt > newBlockStartUtc);
  if (affected.length === 0) return { moves: [], unplaceable: [] };

  const obstacles: Interval[] = [
    ...blocks,
    { startAt: newBlockStartUtc, endAt: newBlockEndUtc },
  ];

  const moves: ShiftMove[] = [];
  const unplaceable: ShiftLaterPlan["unplaceable"] = [];
  let cursor = newBlockEndUtc;

  for (const bk of affected) {
    const base = new Date(Math.max(cursor.getTime(), bk.startAt.getTime()));
    const placed = pushPastBlocks(base, bk.durationMin, obstacles);
    if (placed.end > closeUtc) {
      unplaceable.push({ bookingId: bk.id, reason: "after_close" });
      continue;
    }
    if (placed.start.getTime() === bk.startAt.getTime()) {
      cursor = bk.endAt;
      continue;
    }
    moves.push({
      bookingId: bk.id,
      oldStart: bk.startAt,
      oldEnd: bk.endAt,
      newStart: placed.start,
      newEnd: placed.end,
      durationMin: bk.durationMin,
    });
    cursor = placed.end;
  }
  return { moves, unplaceable };
}

export async function applyMoves(moves: ShiftMove[]): Promise<void> {
  if (moves.length === 0) return;
  await prisma.$transaction(
    moves.map((m) =>
      prisma.booking.update({
        where: { id: m.bookingId },
        data: { startAt: m.newStart, endAt: m.newEnd },
      }),
    ),
  );
}
