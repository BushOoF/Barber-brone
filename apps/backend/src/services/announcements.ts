import { InputFile } from "grammy";
import { prisma } from "../lib/prisma.js";
import { bot } from "../bot/index.js";

export interface BroadcastInput {
  message: string;
  photo?: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
  };
  sentByUserId: string;
}

export interface BroadcastResult {
  id: string;
  recipients: number;
  delivered: number;
  failed: number;
  photoFileId: string | null;
  photoName: string | null;
}

/**
 * Broadcast an announcement (with optional photo) to every customer with a phone.
 *
 * Photo strategy:
 *   - First recipient: upload via Telegram multipart (InputFile around the Buffer).
 *     Capture the largest-size `file_id` from the response.
 *   - All subsequent recipients: send by `file_id` string — Telegram serves from
 *     its CDN, no re-upload cost. This means 1000 recipients = 1 upload + 999
 *     cheap reuses instead of 1000 uploads.
 *
 * Rate limiting: sequential sends with a 40 ms gap to stay under Telegram's
 * 30-msgs/sec ceiling for different recipients.
 */
export async function broadcastAnnouncement(input: BroadcastInput): Promise<BroadcastResult> {
  const recipients = await prisma.user.findMany({
    where: { role: "CUSTOMER", phone: { not: null }, telegramId: { not: null } },
    select: { telegramId: true },
  });

  const announcement = await prisma.announcement.create({
    data: {
      message: input.message,
      photoName: input.photo?.filename ?? null,
      sentByUserId: input.sentByUserId,
      recipients: recipients.length,
    },
  });

  let delivered = 0;
  let failed = 0;
  let cachedFileId: string | null = null;

  for (const r of recipients) {
    try {
      if (input.photo) {
        // file_id (string) once we have it, else InputFile (multipart) for the first send.
        const photoArg = cachedFileId ?? new InputFile(input.photo.buffer, input.photo.filename);
        const sent = await bot.api.sendPhoto(Number(r.telegramId), photoArg, {
          caption: input.message || undefined,
        });
        if (!cachedFileId && sent.photo && sent.photo.length > 0) {
          // Telegram returns multiple sizes; the last one is the largest.
          cachedFileId = sent.photo[sent.photo.length - 1].file_id;
        }
      } else {
        await bot.api.sendMessage(Number(r.telegramId), input.message);
      }
      delivered++;
    } catch (err) {
      failed++;
      console.error(`[announcements] failed for ${r.telegramId}:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const updated = await prisma.announcement.update({
    where: { id: announcement.id },
    data: { delivered, failed, photoFileId: cachedFileId },
  });

  return {
    id: updated.id,
    recipients: updated.recipients,
    delivered: updated.delivered,
    failed: updated.failed,
    photoFileId: updated.photoFileId,
    photoName: updated.photoName,
  };
}
