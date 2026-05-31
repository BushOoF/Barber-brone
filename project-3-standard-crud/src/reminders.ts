/**
 * Barber reminder cron. Every minute, find SCHEDULED appointments whose
 * reminderSentAt is null and whose startAt falls inside a ~1-minute window
 * centred on (now + REMINDER_LEAD_MIN). DM the owning barber, then stamp
 * reminderSentAt. One failed send must not abort the batch.
 */
import cron from "node-cron";
import type { Bot } from "grammy";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { formatTime } from "./time.js";

const WINDOW_MS = 30_000; // +/- 30 seconds around the target instant.

function describeClient(appt: {
  isWalkIn: boolean;
  client: { name: string | null; phone: string | null } | null;
}): string {
  if (appt.client) {
    const parts: string[] = [];
    if (appt.client.name) parts.push(appt.client.name);
    if (appt.client.phone) parts.push(appt.client.phone);
    if (parts.length > 0) return parts.join(" · ");
  }
  return appt.isWalkIn ? "walk-in" : "walk-in";
}

export async function runReminderTick(bot: Bot): Promise<void> {
  const now = Date.now();
  const lo = new Date(now + env.REMINDER_LEAD_MIN * 60000 - WINDOW_MS);
  const hi = new Date(now + env.REMINDER_LEAD_MIN * 60000 + WINDOW_MS);

  const due = await prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startAt: { gte: lo, lte: hi },
    },
    include: { client: true, barber: true },
    orderBy: { startAt: "asc" },
  });

  for (const appt of due) {
    const when = formatTime(appt.startAt);
    const who = describeClient(appt);
    const text = `⏰ Client coming at ${when} — ${who}`;
    try {
      await bot.api.sendMessage(Number(appt.barber.telegramId), text);
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      // Log and continue — do not let one bad send stop the rest.
      console.error(`[reminders] failed to remind barber ${appt.barber.telegramId} for appt ${appt.id}:`, err);
    }
  }
}

/** Start the every-minute cron. Returns the scheduled task handle. */
export function startReminderCron(bot: Bot): cron.ScheduledTask {
  const task = cron.schedule(
    "* * * * *",
    () => {
      void runReminderTick(bot).catch((err) => console.error("[reminders] tick failed:", err));
    },
    { timezone: env.SHOP_TZ },
  );
  console.log(`✓ reminder cron scheduled (every minute, lead ${env.REMINDER_LEAD_MIN}m, tz ${env.SHOP_TZ})`);
  return task;
}
