/**
 * Small timezone helper.
 *
 * The DB stores everything in UTC. The shop (and the barber's spoken times)
 * live in SHOP_TZ (default Asia/Tashkent). These helpers convert between the
 * two using the built-in Intl APIs, so we pull in no extra date library.
 *
 * Approach: to interpret a wall-clock time in a named zone we compute that
 * zone's UTC offset *at that instant* via Intl, then subtract it. This handles
 * DST correctly (Asia/Tashkent has no DST, but other shops might).
 */
import { env } from "../config/env.js";

const TZ = env.SHOP_TZ;

/** Parts of a wall-clock time in a given zone. */
interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Break a UTC instant into its wall-clock parts in SHOP_TZ. */
function getZonedParts(instant: Date): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  // Intl can emit "24" for midnight in some engines; normalise to 0.
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** The UTC offset of SHOP_TZ, in milliseconds, at the given instant. */
function offsetMs(instant: Date): number {
  const p = getZonedParts(instant);
  // What UTC time would produce these wall-clock parts if they *were* UTC?
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in SHOP_TZ to the corresponding UTC Date.
 * monthIndex is 0-based (JS convention) to match Date.UTC.
 */
function zonedWallClockToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  // First guess: treat the wall clock as if it were UTC.
  const guess = Date.UTC(year, monthIndex, day, hour, minute, second);
  // The offset at that approximate instant (DST-safe to within one transition).
  const off = offsetMs(new Date(guess));
  return new Date(guess - off);
}

/** A local date expressed as YYYY-MM-DD (shop timezone). */
export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Today's date in SHOP_TZ. */
export function todayInShopTz(now: Date = new Date()): LocalDate {
  const p = getZonedParts(now);
  return { year: p.year, month: p.month, day: p.day };
}

/** Parse "YYYY-MM-DD" into a LocalDate. Throws on malformed input. */
export function parseLocalDate(s: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Expected date as YYYY-MM-DD, got "${s}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Inclusive start (00:00:00) of a local day, as a UTC instant. */
export function startOfLocalDayUtc(d: LocalDate): Date {
  return zonedWallClockToUtc(d.year, d.month - 1, d.day, 0, 0, 0);
}

/** Exclusive end (start of next day) of a local day, as a UTC instant. */
export function endOfLocalDayUtc(d: LocalDate): Date {
  const start = startOfLocalDayUtc(d);
  // Add 24h then re-resolve to the next local midnight (handles DST shifts).
  const next = getZonedParts(new Date(start.getTime() + 24 * 60 * 60 * 1000));
  return zonedWallClockToUtc(next.year, next.month - 1, next.day, 0, 0, 0);
}

/**
 * Combine a local date with an "HH:MM" wall-clock time into a UTC instant.
 * Used by the voice tools (barber speaks times in shop-local 24h).
 */
export function localDateTimeToUtc(d: LocalDate, hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Expected time as HH:MM, got "${hhmm}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Time out of range: "${hhmm}"`);
  }
  return zonedWallClockToUtc(d.year, d.month - 1, d.day, hour, minute, 0);
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Format a UTC instant as "HH:MM" in SHOP_TZ. */
export function formatTime(instant: Date): string {
  return timeFormatter.format(instant);
}

/** Format a UTC instant as "YYYY-MM-DD" in SHOP_TZ. */
export function formatDate(instant: Date): string {
  return dateFormatter.format(instant);
}

/** Human label like "2026-05-31 14:30" in SHOP_TZ. */
export function formatDateTime(instant: Date): string {
  return `${formatDate(instant)} ${formatTime(instant)}`;
}
