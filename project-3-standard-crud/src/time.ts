/**
 * Timezone helpers. All timestamps are STORED in UTC and DISPLAYED in SHOP_TZ.
 *
 * We avoid pulling in a date library. Conversions between a wall-clock time in
 * SHOP_TZ and a UTC Date use Intl.DateTimeFormat to discover the zone's offset
 * for a given instant, which correctly accounts for DST (Asia/Tashkent has no
 * DST today, but this stays correct if SHOP_TZ is changed to a zone that does).
 */
import { env } from "./env.js";

const TZ = env.SHOP_TZ;

/** Parts of a wall-clock time, all numbers. */
export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

/**
 * Given an instant, return what the wall clock reads in `tz`.
 */
function instantToWallClock(date: Date, tz: string): WallClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  let hour = get("hour");
  // Intl can emit "24" for midnight in hour12:false mode on some runtimes.
  if (hour === 24) hour = 0;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The offset (in minutes) of `tz` from UTC at the given instant.
 * offsetMinutes = localWallClock - utcWallClock.
 */
function tzOffsetMinutes(date: Date, tz: string): number {
  const wc = instantToWallClock(date, tz);
  // Treat the wall-clock components as if they were UTC, then diff against the
  // real instant. The difference is the zone's offset at that instant.
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in SHOP_TZ to a UTC Date.
 * Iterates once to settle DST boundaries.
 */
export function zonedWallClockToUtc(wc: WallClock, tz: string = TZ): Date {
  const asIfUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // First guess: subtract the offset computed at the guessed instant.
  let offset = tzOffsetMinutes(new Date(asIfUtc), tz);
  let utcMs = asIfUtc - offset * 60000;
  // Re-check the offset at the resolved instant and correct once if it changed
  // (handles times near a DST transition).
  const offset2 = tzOffsetMinutes(new Date(utcMs), tz);
  if (offset2 !== offset) {
    offset = offset2;
    utcMs = asIfUtc - offset * 60000;
  }
  return new Date(utcMs);
}

/** Start-of-day (00:00:00 local) as a UTC Date for the given local date. */
export function startOfLocalDay(year: number, month: number, day: number, tz: string = TZ): Date {
  return zonedWallClockToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, tz);
}

/** [startUtc, endUtc) covering the whole local calendar day. */
export function localDayRange(
  year: number,
  month: number,
  day: number,
  tz: string = TZ,
): { start: Date; end: Date } {
  const start = startOfLocalDay(year, month, day, tz);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The local calendar date (y/m/d) of an instant, in SHOP_TZ. */
export function localDateOf(date: Date, tz: string = TZ): { year: number; month: number; day: number } {
  const wc = instantToWallClock(date, tz);
  return { year: wc.year, month: wc.month, day: wc.day };
}

/** "now" expressed as local Y/M/D. */
export function todayLocal(tz: string = TZ): { year: number; month: number; day: number } {
  return localDateOf(new Date(), tz);
}

/** Add `days` to a local date, returning a normalized {year,month,day}. */
export function addLocalDays(
  base: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  // Use a UTC anchor purely for calendar arithmetic (no tz involved here).
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Build a UTC Date from a local date + "HH:MM". Throws on malformed time. */
export function localDateTimeToUtc(
  date: { year: number; month: number; day: number },
  hhmm: string,
  tz: string = TZ,
): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time "${hhmm}", hours 0-23 and minutes 0-59`);
  }
  return zonedWallClockToUtc(
    { year: date.year, month: date.month, day: date.day, hour, minute, second: 0 },
    tz,
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "HH:MM" in SHOP_TZ. */
export function formatTime(date: Date, tz: string = TZ): string {
  const wc = instantToWallClock(date, tz);
  return `${pad2(wc.hour)}:${pad2(wc.minute)}`;
}

/** e.g. "Mon, 02 Jun 2026" in SHOP_TZ. */
export function formatDate(date: Date, tz: string = TZ): string {
  const wc = instantToWallClock(date, tz);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return `${weekday}, ${pad2(wc.day)} ${MONTHS[wc.month - 1]} ${wc.year}`;
}

/** e.g. "Mon, 02 Jun 2026 14:30" in SHOP_TZ. */
export function formatDateTime(date: Date, tz: string = TZ): string {
  return `${formatDate(date, tz)} ${formatTime(date, tz)}`;
}

/** "Mon 02 Jun" short label for a local date object (no instant needed). */
export function formatLocalDateShort(d: { year: number; month: number; day: number }): string {
  const anchor = new Date(Date.UTC(d.year, d.month - 1, d.day, 12, 0, 0));
  const weekday = WEEKDAYS[anchor.getUTCDay()];
  return `${weekday} ${pad2(d.day)} ${MONTHS[d.month - 1]}`;
}

/** YYYY-MM-DD for a local date object (used as callback payloads). */
export function localDateKey(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/** Parse a YYYY-MM-DD key back into a local date object. */
export function parseLocalDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const SHOP_TZ = TZ;
