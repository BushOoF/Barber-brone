/**
 * Commit handlers for confirmed voice commands. Each reuses the existing
 * scheduling/pricing/availability/smart-shift/notify/announcement services so
 * voice writes behave exactly like the webapp + dashboard.
 */
import type { Lang } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { prisma } from "../lib/prisma.js";
import { quote, normalizeSelection, type BookingSelection } from "./pricing.js";
import { findNextSlot, isSlotAvailable } from "./availability.js";
import { planShiftLater, planShiftEarlier, applyMoves } from "./smart-shift.js";
import {
  notifyBookingConfirmed,
  notifyShiftedLater,
  notifyShiftedEarlier,
  safeSend,
} from "./notify.js";
import { broadcastAnnouncement } from "./announcements.js";
import {
  addMinutes,
  formatLocalTime,
  localDateKey,
  localDateTimeToUtc,
  localDayBoundsUtc,
  localMinutesOfDay,
  todayKey,
} from "../lib/time.js";

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun .. 6=Sat
}

/** Resolve a date token (today | tomorrow | weekday | YYYY-MM-DD) to a shop-local date key. */
export function resolveDateKey(date?: string | null): string {
  if (!date) return todayKey();
  const d = date.trim().toLowerCase();
  if (d === "" || d === "today") return todayKey();
  if (d === "tomorrow") return localDateKey(new Date(Date.now() + 24 * 60 * 60_000));
  const wd = WEEKDAYS.indexOf(d);
  if (wd >= 0) {
    for (let i = 0; i < 7; i++) {
      const key = localDateKey(new Date(Date.now() + i * 24 * 60 * 60_000));
      if (weekdayOfKey(key) === wd) return key;
    }
  }
  return date; // assume YYYY-MM-DD
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function langOf(u: { language?: Lang | string | null }): Lang {
  const v = (u.language ?? "UZ").toString().toUpperCase();
  return (v === "UZ" || v === "RU" || v === "EN" ? v : "UZ") as Lang;
}

async function defaultBarberId(): Promise<string | null> {
  const main = await prisma.barber.findFirst({ where: { isActive: true, role: "MAIN" } });
  if (main) return main.id;
  const any = await prisma.barber.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  return any?.id ?? null;
}

// ---------------------------------------------------------------------------
// Customer booking
// ---------------------------------------------------------------------------

export type BookWhen =
  | { when: "asap" }
  | { when: "time"; time: string; date?: string | null };

export type BookResult =
  | { ok: true; startAt: Date; durationMin: number; barberName: string }
  | { ok: false; reason: "no_barber" | "no_slot" | "slot_taken" | "no_services" };

export async function bookForCustomer(userId: string, sel: BookWhen): Promise<BookResult> {
  const barberId = await defaultBarberId();
  if (!barberId) return { ok: false, reason: "no_barber" };
  const barber = await prisma.barber.findUnique({ where: { id: barberId } });
  if (!barber) return { ok: false, reason: "no_barber" };

  const allServices = await prisma.service.findMany({ where: { isActive: true } });
  const selection: BookingSelection = {
    adults: 1,
    children: 0,
    serviceKeys: [],
    selectedAdultStyleKey: null,
    selectedChildStyleKey: null,
  };
  let q;
  try {
    q = quote(allServices, selection);
  } catch {
    return { ok: false, reason: "no_services" };
  }
  if (q.durationMin <= 0) return { ok: false, reason: "no_services" };

  let startAt: Date;
  if (sel.when === "asap") {
    const slot = await findNextSlot(barberId, q.durationMin, new Date());
    if (!slot) return { ok: false, reason: "no_slot" };
    startAt = slot.startAt;
  } else {
    const dateKey = resolveDateKey(sel.date);
    startAt = localDateTimeToUtc(dateKey, hhmmToMinutes(sel.time));
    if (startAt.getTime() < Date.now()) {
      const slot = await findNextSlot(barberId, q.durationMin, new Date());
      if (!slot) return { ok: false, reason: "no_slot" };
      startAt = slot.startAt;
    } else if (!(await isSlotAvailable(barberId, startAt, q.durationMin))) {
      return { ok: false, reason: "slot_taken" };
    }
  }

  const booking = await prisma.booking.create({
    data: {
      userId,
      barberId,
      startAt,
      endAt: addMinutes(startAt, q.durationMin),
      durationMin: q.durationMin,
      totalPriceMinor: q.totalPriceMinor,
      adults: 1,
      children: 0,
      services: normalizeSelection(selection, allServices),
      remindersOn: true,
      status: "SCHEDULED",
    },
  });
  void notifyBookingConfirmed(booking.id);
  return { ok: true, startAt, durationMin: q.durationMin, barberName: barber.displayName };
}

// ---------------------------------------------------------------------------
// Cancellation (booking + break)
// ---------------------------------------------------------------------------

export type CancelResult =
  | { ok: true; startAt: Date }
  | { ok: false; reason: "none" | "not_found" | "ambiguous"; count?: number };

function bookingMatches(b: { startAt: Date }, timeMin: number | null, dateKey: string | null): boolean {
  if (dateKey && localDateKey(b.startAt) !== dateKey) return false;
  if (timeMin != null && localMinutesOfDay(b.startAt) !== timeMin) return false;
  return true;
}

/** A customer cancels their own upcoming booking. Runs smart-shift-earlier for the barber's later clients. */
export async function cancelBookingForCustomer(
  userId: string,
  timeMin: number | null,
  dateToken: string | null,
): Promise<CancelResult> {
  const now = new Date();
  const upcoming = await prisma.booking.findMany({
    where: { userId, status: "SCHEDULED", endAt: { gte: now } },
    orderBy: { startAt: "asc" },
  });
  if (upcoming.length === 0) return { ok: false, reason: "none" };
  const dateKey = dateToken ? resolveDateKey(dateToken) : null;
  const cands = timeMin != null || dateKey ? upcoming.filter((b) => bookingMatches(b, timeMin, dateKey)) : upcoming;
  if (cands.length === 0) return { ok: false, reason: "not_found" };
  if (cands.length > 1) return { ok: false, reason: "ambiguous", count: cands.length };

  const b = cands[0];
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED_BY_USER" } });
  const moves = await planShiftEarlier(b.barberId, b.startAt, b.endAt);
  await applyMoves(moves);
  for (const m of moves) void notifyShiftedEarlier(m.bookingId, m.oldStart);
  return { ok: true, startAt: b.startAt };
}

/** The barber cancels a booking on their schedule; the affected customer is notified. */
export async function cancelBookingForBarber(
  barberId: string,
  timeMin: number | null,
  dateToken: string | null,
): Promise<CancelResult> {
  const now = new Date();
  const upcoming = await prisma.booking.findMany({
    where: { barberId, status: "SCHEDULED", endAt: { gte: now } },
    orderBy: { startAt: "asc" },
    include: { user: true },
  });
  if (upcoming.length === 0) return { ok: false, reason: "none" };
  const dateKey = dateToken ? resolveDateKey(dateToken) : null;
  const cands = timeMin != null || dateKey ? upcoming.filter((b) => bookingMatches(b, timeMin, dateKey)) : upcoming;
  if (cands.length === 0) return { ok: false, reason: "not_found" };
  if (cands.length > 1) return { ok: false, reason: "ambiguous", count: cands.length };

  const b = cands[0];
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED_BY_USER" } });
  // Tell the customer their booking was cancelled by the shop.
  void safeSend(b.user.telegramId, t(langOf(b.user), "notify.cancelled_by_shop", { time: formatLocalTime(b.startAt) }));
  const moves = await planShiftEarlier(b.barberId, b.startAt, b.endAt);
  await applyMoves(moves);
  for (const m of moves) void notifyShiftedEarlier(m.bookingId, m.oldStart);
  return { ok: true, startAt: b.startAt };
}

export type CancelBreakResult =
  | { ok: true; start: string; end: string }
  | { ok: false; reason: "none" | "not_found" | "ambiguous"; count?: number };

export async function cancelBreakForBarber(
  barberId: string,
  startMin: number | null,
  dateToken: string | null,
): Promise<CancelBreakResult> {
  const dateKey = dateToken ? resolveDateKey(dateToken) : todayKey();
  const { start, end } = localDayBoundsUtc(dateKey);
  const blocks = await prisma.timeBlock.findMany({
    where: { barberId, startAt: { gte: start, lt: end } },
    orderBy: { startAt: "asc" },
  });
  if (blocks.length === 0) return { ok: false, reason: "none" };
  const cands = startMin != null ? blocks.filter((b) => localMinutesOfDay(b.startAt) === startMin) : blocks;
  if (cands.length === 0) return { ok: false, reason: "not_found" };
  if (cands.length > 1) return { ok: false, reason: "ambiguous", count: cands.length };

  const blk = cands[0];
  await prisma.timeBlock.delete({ where: { id: blk.id } });
  return { ok: true, start: formatLocalTime(blk.startAt), end: formatLocalTime(blk.endAt) };
}

// ---------------------------------------------------------------------------
// Break + walk-in (any day for breaks)
// ---------------------------------------------------------------------------

export interface BreakResult {
  startAt: Date;
  endAt: Date;
  dateKey: string;
  shifted: number;
}

export async function createBreakForBarber(
  barberId: string,
  startMin: number,
  endMin: number,
  dateToken: string | null,
  note?: string | null,
): Promise<BreakResult> {
  const dateKey = dateToken ? resolveDateKey(dateToken) : todayKey();
  const startAt = localDateTimeToUtc(dateKey, startMin);
  const endAt = localDateTimeToUtc(dateKey, endMin);
  const plan = await planShiftLater(barberId, startAt, endAt);
  await applyMoves(plan.moves);
  await prisma.timeBlock.create({ data: { barberId, startAt, endAt, type: "BREAK", note: note ?? null } });
  for (const m of plan.moves) void notifyShiftedLater(m.bookingId, m.oldStart);
  return { startAt, endAt, dateKey, shifted: plan.moves.length };
}

export interface WalkinResult {
  startAt: Date;
  shifted: number;
}

export async function createWalkInForBarber(
  barberId: string,
  startMin: number | null,
  durationMin: number,
  note?: string | null,
): Promise<WalkinResult> {
  const dateKey = todayKey();
  const startAt = startMin != null ? localDateTimeToUtc(dateKey, startMin) : new Date();
  const endAt = addMinutes(startAt, durationMin);
  const plan = await planShiftLater(barberId, startAt, endAt);
  await applyMoves(plan.moves);
  await prisma.timeBlock.create({ data: { barberId, startAt, endAt, type: "WALK_IN", note: note ?? null } });
  for (const m of plan.moves) void notifyShiftedLater(m.bookingId, m.oldStart);
  return { startAt, shifted: plan.moves.length };
}

// ---------------------------------------------------------------------------
// Announcements + settings
// ---------------------------------------------------------------------------

export interface AnnounceResult {
  recipients: number;
  delivered: number;
  failed: number;
}

export async function makeAnnouncement(message: string, sentByUserId: string): Promise<AnnounceResult> {
  const r = await broadcastAnnouncement({ message, sentByUserId });
  return { recipients: r.recipients, delivered: r.delivered, failed: r.failed };
}

export type UpdateServiceResult = { ok: true; name: string } | { ok: false; reason: "not_found" };

async function findServiceByDesc(desc: string) {
  const d = desc.toLowerCase();
  const services = await prisma.service.findMany({ where: { isActive: true } });
  const has = (...kw: string[]) => kw.some((k) => d.includes(k));
  if (has("child", "bola", "детск", "дет"))
    return services.find((s) => s.category === "HAIRCUT_CHILD" && s.isDefault) ??
      services.find((s) => s.category === "HAIRCUT_CHILD") ?? null;
  if (has("beard", "soqol", "бород"))
    return services.find((s) => s.key === "beard") ??
      services.find((s) => s.name.toLowerCase().includes("beard") || s.name.toLowerCase().includes("soqol")) ?? null;
  if (has("wash", "yuv", "мыт", "мой"))
    return services.find((s) => s.key === "wash") ?? services.find((s) => s.name.toLowerCase().includes("wash")) ?? null;
  if (has("adult", "katta", "haircut", "soch", "стриж", "взросл"))
    return services.find((s) => s.category === "HAIRCUT_ADULT" && s.isDefault) ??
      services.find((s) => s.category === "HAIRCUT_ADULT") ?? null;
  return services.find((s) => s.name.toLowerCase().includes(d) || s.key.toLowerCase().includes(d)) ?? null;
}

export async function updateService(
  serviceDesc: string,
  price: number | null,
  durationMin: number | null,
): Promise<UpdateServiceResult> {
  const svc = await findServiceByDesc(serviceDesc);
  if (!svc) return { ok: false, reason: "not_found" };
  await prisma.service.update({
    where: { id: svc.id },
    data: {
      ...(price != null ? { priceMinor: price } : {}),
      ...(durationMin != null ? { durationMin } : {}),
    },
  });
  return { ok: true, name: svc.name };
}

export async function updateHours(openMin: number | null, closeMin: number | null): Promise<void> {
  await prisma.settings.update({
    where: { id: "singleton" },
    data: {
      ...(openMin != null ? { openHourMin: openMin } : {}),
      ...(closeMin != null ? { closeHourMin: closeMin } : {}),
    },
  });
}

export async function addVacation(dateToken: string, note?: string | null): Promise<{ dateKey: string }> {
  const dateKey = resolveDateKey(dateToken);
  await prisma.vacationDay.upsert({
    where: { date: dateKey },
    update: { note: note ?? null },
    create: { date: dateKey, note: note ?? null },
  });
  return { dateKey };
}
