/**
 * Timezone helpers. We store all times in UTC (Prisma DateTime) and convert to
 * the shop's local zone (SHOP_TZ, default Asia/Tashkent) for display and for
 * interpreting "HH:MM" spoken by the barber.
 *
 * Implemented with Intl.DateTimeFormat so we depend on no date library and the
 * image stays small. The approach: compute a zone's UTC offset at a given
 * instant via formatToParts, which the IANA tz database (bundled with Node)
 * resolves including DST. Asia/Tashkent has no DST, but this stays correct for
 * any SHOP_TZ.
 */

const PART_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = PART_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const pick = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  let hour = pick("hour");
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour,
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant (e.g. +300 for Tashkent). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convert a wall-clock local time in `timeZone` to the corresponding UTC Date.
 * Handles the offset self-consistently (good enough across DST except for the
 * rare ambiguous hour, which never occurs for Asia/Tashkent).
 */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0,
  );
  // First approximation of the offset, then refine once.
  const guess = new Date(naiveUtc);
  let offset = offsetMinutes(guess, timeZone);
  let result = new Date(naiveUtc - offset * 60000);
  const offset2 = offsetMinutes(result, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(naiveUtc - offset * 60000);
  }
  return result;
}

/** The local calendar day (Y/M/D in `timeZone`) for a given instant. Defaults to now. */
export function localDateParts(
  timeZone: string,
  instant: Date = new Date(),
): { year: number; month: number; day: number } {
  const p = getZonedParts(instant, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** [startUtc, endUtc) covering the whole local day that contains `instant`. */
export function localDayRangeUtc(
  timeZone: string,
  instant: Date = new Date(),
): { start: Date; end: Date } {
  const { year, month, day } = localDateParts(timeZone, instant);
  const start = zonedTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Resolve a spoken "HH:MM" into a UTC Date on the local day of `baseInstant`.
 * Used for walk-ins / breaks dictated by voice ("today at 14:30").
 */
export function timeOnLocalDayToUtc(
  timeZone: string,
  hour: number,
  minute: number,
  baseInstant: Date = new Date(),
): Date {
  const { year, month, day } = localDateParts(timeZone, baseInstant);
  return zonedTimeToUtc({ year, month, day, hour, minute, second: 0 }, timeZone);
}

const TIME_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
const DATE_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

/** Format an instant as "HH:MM" in the shop zone (24h). */
export function formatTime(instant: Date, timeZone: string): string {
  let fmt = TIME_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    TIME_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt.format(instant);
}

/** Format an instant as a friendly local date, e.g. "Sat, 31 May 2026". */
export function formatDate(instant: Date, timeZone: string): string {
  let fmt = DATE_FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    DATE_FMT_CACHE.set(timeZone, fmt);
  }
  return fmt.format(instant);
}

/** Parse "HH:MM" (24h) into {hour, minute}, or null if malformed/out of range. */
export function parseHhMm(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
