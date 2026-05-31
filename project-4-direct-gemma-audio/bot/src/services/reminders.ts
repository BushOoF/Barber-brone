/**
 * Barber reminder cron.
 *
 * Every minute, find SCHEDULED appointments whose reminderSentAt is null and
 * whose startAt falls inside [now + lead - 30s, now + lead + 30s]. DM the
 * barber, then stamp reminderSentAt. Each send is wrapped so one failure does
 * not abort the batch.
 */
import cron, { type ScheduledTask } from "node-cron";
import type { Bot } from "grammy";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { formatTime } from "../lib/time.js";

const WINDOW_MS = 30_000; // +/- 30s around the lead time

/** Describe the client for the reminder line. */
function clientLabel(client: { name: string | null; phone: string | null } | null, isWalkIn: boolean): string {
  if (!client) return isWalkIn ? "walk-in" : "client";
  const parts: string[] = [];
  if (client.name) parts.push(client.name);
  if (client.phone) parts.push(client.phone);
  if (parts.length === 0) return isWalkIn ? "walk-in" : "client";
  return parts.join(" / ");
}

/** Run one sweep. Exported so it can be unit-tested / invoked manually. */
export async function runReminderSweep(bot: Bot, now: Date = new Date()): Promise<void> {
  const leadMs = env.REMINDER_LEAD_MIN * 60_000;
  const center = new Date(now.getTime() + leadMs);
  const lo = new Date(center.getTime() - WINDOW_MS);
  const hi = new Date(center.getTime() + WINDOW_MS);

  const due = await prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startAt: { gte: lo, lte: hi },
    },
    include: { barber: true, client: true },
  });

  for (const appt of due) {
    try {
      const who = clientLabel(appt.client, appt.isWalkIn);
      const text = `⏰ ${who} coming at ${formatTime(appt.startAt)}`;
      await bot.api.sendMessage(appt.barber.telegramId.toString(), text);
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      // Log and continue — never let one bad send abort the whole batch.
      console.error(`Reminder send failed for appointment ${appt.id}:`, err);
    }
  }
}

/**
 * Schedule the sweep to run every minute. Returns the cron task so the caller
 * can stop it on shutdown. Overlap-guarded so a slow sweep can't pile up.
 */
export function startReminderCron(bot: Bot): ScheduledTask {
  let running = false;
  const task = cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await runReminderSweep(bot);
    } catch (err) {
      console.error("Reminder sweep error:", err);
    } finally {
      running = false;
    }
  });
  console.log(`Reminder cron started (lead=${env.REMINDER_LEAD_MIN}min, tz=${env.SHOP_TZ}).`);
  return task;
}
