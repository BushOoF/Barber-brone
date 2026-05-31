/**
 * Confirm / Cancel callback handler. On Confirm we run the scheduling op that
 * matches the stored pending action; on Cancel we discard it. This is the ONLY
 * place voice-initiated writes hit the DB.
 */
import type { Bot, Context } from "grammy";
import { AppointmentSource, BlockType } from "@prisma/client";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { parseHhMm, timeOnLocalDayToUtc } from "../../lib/tz.js";
import { addClient, createAppointment, createBlock } from "../../scheduling/service.js";
import { describeConflict } from "../format.js";
import { discardPending, takePending, type PendingAction } from "../pending.js";

export function registerCallbacks(bot: Bot): void {
  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const id = ctx.match?.[1];
    if (!userId || !id) {
      await ctx.answerCallbackQuery();
      return;
    }

    const action = takePending(userId, id);
    if (!action) {
      await ctx.answerCallbackQuery({ text: "This request expired. Please record again." });
      await safeEditToText(ctx, "⌛ This request expired. Please send the voice note again.");
      return;
    }

    await ctx.answerCallbackQuery({ text: "Working…" });
    try {
      const text = await runAction(action);
      await safeEditToText(ctx, text);
    } catch (err) {
      logger.error("Failed to apply confirmed action", err instanceof Error ? err.message : err);
      await safeEditToText(ctx, "⚠️ Something went wrong saving that. Please try again.");
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const id = ctx.match?.[1];
    if (!userId || !id) {
      await ctx.answerCallbackQuery();
      return;
    }
    discardPending(userId, id);
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await safeEditToText(ctx, "✖️ Cancelled. Nothing was saved.");
  });
}

/** Execute the action and return the message to show the barber. */
async function runAction(action: PendingAction): Promise<string> {
  switch (action.kind) {
    case "add_client": {
      const client = await addClient({ phone: action.args.phone, name: action.args.name ?? null });
      const label = client.name ? `${client.name} (${client.phone ?? "no phone"})` : (client.phone ?? "client");
      return `✅ Client saved: ${label}`;
    }

    case "create_break": {
      const start = parseHhMm(action.args.start_time);
      const end = parseHhMm(action.args.end_time);
      if (!start || !end) return "⚠️ Those times didn't look valid. Please try again.";
      const startAt = timeOnLocalDayToUtc(env.SHOP_TZ, start.hour, start.minute);
      const endAt = timeOnLocalDayToUtc(env.SHOP_TZ, end.hour, end.minute);
      if (endAt.getTime() <= startAt.getTime()) {
        return "⚠️ The break's end time must be after its start time. Please try again.";
      }
      const { overlapping } = await createBlock({
        barberId: action.barberId,
        startAt,
        endAt,
        type: BlockType.BREAK,
        note: action.args.note ?? null,
      });
      let msg = `✅ Break saved ${action.args.start_time}–${action.args.end_time}.`;
      if (overlapping.length > 0) {
        // We do NOT auto-cancel — just warn (per spec).
        msg += `\n\n⚠️ Heads up: this overlaps ${overlapping.length} existing appointment(s). They were NOT cancelled — review with /today.`;
      }
      return msg;
    }

    case "add_walkin": {
      // Walk-in: a client the barber is seeing now / shortly. Modelled as an
      // appointment with isWalkIn=true and source=VOICE.
      const durationMin = action.args.duration_min ?? 30;
      let startAt: Date;
      if (action.args.start_time) {
        const t = parseHhMm(action.args.start_time);
        if (!t) return "⚠️ That start time didn't look valid. Please try again.";
        startAt = timeOnLocalDayToUtc(env.SHOP_TZ, t.hour, t.minute);
      } else {
        startAt = new Date(); // "now"
      }
      const res = await createAppointment({
        barberId: action.barberId,
        startAt,
        durationMin,
        isWalkIn: true,
        note: action.args.note ?? null,
        source: AppointmentSource.VOICE,
      });
      if (!res.ok) {
        return describeConflict(res.conflict) + "\n\nNothing was saved.";
      }
      const when = action.args.start_time ?? "now";
      return `✅ Walk-in saved at ${when} for ${durationMin} min.`;
    }
  }
}

/** Replace the message text and remove the inline keyboard, ignoring "not modified" noise. */
async function safeEditToText(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch {
    // If editing fails (message too old, identical, etc.), fall back to a reply.
    try {
      await ctx.reply(text);
    } catch {
      /* give up silently */
    }
  }
}
