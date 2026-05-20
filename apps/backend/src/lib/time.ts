import { env } from "./env.js";

/**
 * Minimal timezone helpers tailored for the shop's local timezone (default Asia/Tashkent, UTC+5, no DST).
 *
 * We deliberately avoid heavy date libraries — all storage is UTC, only display/grouping needs the local zone.
 */

const tz = env.SHOP_TIMEZONE;

/** Format a Date as ISO yyyy-mm-dd in the shop timezone. */
export function localDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

/** Hour:minute as a 0..1439 integer (minutes since shop-local midnight). */
export function localMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

/** Local "HH:MM" string in the shop timezone. */
export function formatLocalTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Given a date key (yyyy-mm-dd) interpreted in the shop timezone and a minute-of-day offset,
 * return the corresponding UTC Date.
 *
 * Works for any fixed-offset zone (Asia/Tashkent is UTC+5). For zones with DST we'd need a fuller library.
 */
export function localDateTimeToUtc(dateKey: string, minutesOfDay: number): Date {
  const offsetMinutes = timezoneOffsetMinutes(dateKey);
  const [y, m, d] = dateKey.split("-").map(Number);
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  // Compose UTC ms from local components, then subtract zone offset.
  const utcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0) - offsetMinutes * 60_000;
  return new Date(utcMs);
}

/** Offset of the shop timezone from UTC, in minutes (positive = east of UTC). */
function timezoneOffsetMinutes(dateKey: string): number {
  // Use a stable noon-of-day probe to side-step DST edges.
  const [y, m, d] = dateKey.split("-").map(Number);
  const probeUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(probeUtc);
  const lh = Number(parts.find((p) => p.type === "hour")!.value);
  const lm = Number(parts.find((p) => p.type === "minute")!.value);
  // local minutes - UTC minutes (at probe = 12*60 = 720) gives the offset, normalized into ±720.
  let diff = lh * 60 + lm - 720;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

/** Bounds [startUtc, endUtc) for a local date in the shop timezone. */
export function localDayBoundsUtc(dateKey: string): { start: Date; end: Date } {
  const start = localDateTimeToUtc(dateKey, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

/** Today's date key in the shop timezone. */
export function todayKey(): string {
  return localDateKey(new Date());
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
