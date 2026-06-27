import type { Booking } from "@prisma/client";
import { bot } from "../bot/index.js";
import { prisma } from "../lib/prisma.js";
import { formatLocalTime } from "../lib/time.js";
import { formatMoney } from "../lib/money.js";
import { DEFAULT_LANG, escapeMd, t, type Lang } from "../lib/i18n.js";

/** Send a Telegram message; swallow & log errors so a single failed delivery doesn't break batch flows. */
export async function safeSend(telegramId: bigint | null, text: string): Promise<void> {
  // Placeholder (phone-only) users have no Telegram account yet — nothing to send to.
  if (telegramId == null) return;
  try {
    await bot.api.sendMessage(Number(telegramId), text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(`Failed to message user ${telegramId}:`, err);
  }
}

function langOf(u: { language?: Lang | string | null }): Lang {
  const v = (u.language ?? DEFAULT_LANG).toString().toUpperCase();
  return (v === "UZ" || v === "RU" || v === "EN" ? v : DEFAULT_LANG) as Lang;
}

export async function notifyBookingConfirmed(bookingId: string): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true, barber: true },
  });
  if (!b) return;
  const lang = langOf(b.user);
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const remNote = b.remindersOn ? t(lang, "notify.reminder_will") : t(lang, "notify.reminders_off");
  // Prefer GPS coords for the map link when present; otherwise geocode the text.
  let locationText: string | null = null;
  if (settings?.locationLat != null && settings?.locationLng != null) {
    const mapUrl = `https://maps.google.com/?q=${settings.locationLat},${settings.locationLng}`;
    locationText = settings.location ? `[${escapeMd(settings.location)}](${mapUrl})` : mapUrl;
  } else if (settings?.location) {
    locationText = escapeMd(settings.location);
  }
  const locationLine = locationText
    ? t(lang, "notify.location_line", { location: locationText })
    : "";
  const text = t(lang, "notify.confirmed", {
    barber: escapeMd(b.barber.displayName),
    time: formatLocalTime(b.startAt),
    dur: b.durationMin,
    total: formatMoney(b.totalPriceMinor),
    location: locationLine,
    rem: remNote,
  });
  await safeSend(b.user.telegramId, text);
}

export async function notifyShiftedEarlier(bookingId: string, fromStart: Date): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true },
  });
  if (!b) return;
  const lang = langOf(b.user);
  await safeSend(
    b.user.telegramId,
    t(lang, "notify.shifted_earlier", {
      old: formatLocalTime(fromStart),
      new: formatLocalTime(b.startAt),
    }),
  );
}

export async function notifyShiftedLater(bookingId: string, fromStart: Date): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true },
  });
  if (!b) return;
  const lang = langOf(b.user);
  await safeSend(
    b.user.telegramId,
    t(lang, "notify.shifted_later", {
      old: formatLocalTime(fromStart),
      new: formatLocalTime(b.startAt),
    }),
  );
}

export async function notifyTransferred(bookingId: string, oldBarberName: string, newBarberName: string): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true },
  });
  if (!b) return;
  const lang = langOf(b.user);
  await safeSend(
    b.user.telegramId,
    t(lang, "notify.transferred", {
      time: formatLocalTime(b.startAt),
      oldBarber: escapeMd(oldBarberName),
      newBarber: escapeMd(newBarberName),
    }),
  );
}

export async function notifyReminder(b: Booking & { user: { telegramId: bigint | null; language?: Lang | string | null } }): Promise<void> {
  const lang = langOf(b.user);
  await safeSend(b.user.telegramId, t(lang, "notify.reminder", { time: formatLocalTime(b.startAt) }));
}
