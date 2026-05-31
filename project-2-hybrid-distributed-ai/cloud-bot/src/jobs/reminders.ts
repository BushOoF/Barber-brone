/**
 * Barber reminder job. Runs every minute (node-cron).
 *
 * Finds SCHEDULED appointments with reminderSentAt == null whose startAt falls
 * in [now + LEAD - 30s, now + LEAD + 30s], DMs the barber, then stamps
 * reminderSentAt. Each send is wrapped so one failure does not abort the batch.
 */
import cron from "node-cron";
import type { Bot } from "grammy";
import { env } from "../env.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { formatTime } from "../lib/tz.js";
import { sweepExpired } from "../bot/pending.js";

const WINDOW_MS = 30_000; // ±30s

async function runOnce(bot: Bot): Promise<void> {
  const now = Date.now();
  const target = now + env.REMINDER_LEAD_MIN * 60_000;
  const from = new Date(target - WINDOW_MS);
  const to = new Date(target + WINDOW_MS);

  const due = await prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startAt: { gte: from, lte: to },
    },
    include: { barber: true, client: true },
    orderBy: { startAt: "asc" },
  });

  for (const appt of due) {
    const who = appt.client?.name
      ? appt.client.name
      : appt.client?.phone
        ? appt.client.phone
        : appt.isWalkIn
          ? "walk-in"
          : "walk-in";
    const at = formatTime(appt.startAt, env.SHOP_TZ);
    const text = `⏰ Reminder: ${who} coming at ${at}.`;

    try {
      await bot.api.sendMessage(appt.barber.telegramId.toString(), text);
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      // Do not stamp reminderSentAt on failure, so it retries next minute.
      logger.warn(`Failed to send reminder for appointment ${appt.id}`, err instanceof Error ? err.message : err);
    }
  }

  // Piggyback pending-action GC on the same minute tick.
  sweepExpired(now);
}

/** Start the cron schedule. Returns the task so the caller can stop it on shutdown. */
export function startReminderJob(bot: Bot): cron.ScheduledTask {
  const task = cron.schedule("* * * * *", () => {
    runOnce(bot).catch((err) => {
      logger.error("Reminder tick failed", err instanceof Error ? err.message : err);
    });
  });
  logger.info(`Reminder job started (lead ${env.REMINDER_LEAD_MIN} min, every minute).`);
  return task;
}
