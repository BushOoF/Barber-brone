import { prisma } from "../lib/prisma.js";
import { bot } from "../bot/index.js";

/**
 * Broadcast an announcement message to every customer that has shared their
 * contact (i.e. has a phone number on file). We exclude staff so the barber
 * doesn't message themselves.
 *
 * Telegram rate-limits bots to ~30 msgs/sec to different users. We send
 * sequentially with a small delay between batches so we stay well under that.
 */
export async function broadcastAnnouncement(
  message: string,
  sentByUserId: string,
): Promise<{ id: string; recipients: number; delivered: number; failed: number }> {
  const recipients = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      phone: { not: null },
    },
    select: { telegramId: true },
  });

  const announcement = await prisma.announcement.create({
    data: {
      message,
      sentByUserId,
      recipients: recipients.length,
    },
  });

  let delivered = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(Number(r.telegramId), message);
      delivered++;
    } catch (err) {
      failed++;
      console.error(`[announcements] failed for ${r.telegramId}:`, err);
    }
    // ~25 msgs/sec — comfortably below Telegram's 30/sec limit for different users.
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const updated = await prisma.announcement.update({
    where: { id: announcement.id },
    data: { delivered, failed },
  });

  return {
    id: updated.id,
    recipients: updated.recipients,
    delivered: updated.delivered,
    failed: updated.failed,
  };
}
