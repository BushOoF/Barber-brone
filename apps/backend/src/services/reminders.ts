import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { notifyReminder } from "./notify.js";

/**
 * Every minute, scan for SCHEDULED bookings starting in the next `reminderLeadMin`±30s window
 * that haven't had their reminder sent yet, and send them.
 */
export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    try {
      const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
      const leadMin = settings?.reminderLeadMin ?? 15;
      const target = new Date(Date.now() + leadMin * 60_000);
      const windowStart = new Date(target.getTime() - 30_000);
      const windowEnd = new Date(target.getTime() + 30_000);

      const due = await prisma.booking.findMany({
        where: {
          status: "SCHEDULED",
          remindersOn: true,
          reminderSentAt: null,
          startAt: { gte: windowStart, lte: windowEnd },
        },
        include: { user: { select: { telegramId: true, language: true } } },
      });

      for (const b of due) {
        await notifyReminder(b);
        await prisma.booking.update({
          where: { id: b.id },
          data: { reminderSentAt: new Date() },
        });
      }
    } catch (err) {
      console.error("Reminder cron failed:", err);
    }
  });
  console.log("✓ Reminder cron started (1-minute tick)");
}
