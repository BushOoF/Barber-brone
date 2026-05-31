/** /start and /today command handlers. */
import type { Bot, Context } from "grammy";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { localDayRangeUtc } from "../../lib/tz.js";
import { listDay } from "../../scheduling/service.js";
import { resolveBarber } from "../barber.js";
import { renderDay } from "../format.js";

const NOT_ADMIN =
  "This bot is private to the barbershop staff. If you are the barber, ask the owner to add your Telegram ID to ADMIN_TELEGRAM_IDS.";

const START_TEXT = [
  "✂️ *Barbershop scheduling bot*",
  "",
  "I keep your day organised. You can:",
  "• Send me a *voice note* to add a client, a break, or a walk-in — I'll read it back and ask you to confirm.",
  "• /today — see today's schedule.",
  "",
  `Times are shown in *${env.SHOP_TZ}*. I'll also ping you ${env.REMINDER_LEAD_MIN} min before each appointment.`,
].join("\n");

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const barber = await resolveBarber(userId);
    if (!barber) {
      await ctx.reply(NOT_ADMIN);
      return;
    }
    await ctx.reply(START_TEXT, { parse_mode: "Markdown" });
  });

  bot.command("today", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const barber = await resolveBarber(userId);
    if (!barber) {
      await ctx.reply(NOT_ADMIN);
      return;
    }
    try {
      const now = new Date();
      const range = localDayRangeUtc(env.SHOP_TZ, now);
      const day = await listDay(barber.id, range);
      await ctx.reply(renderDay(day, now));
    } catch (err) {
      logger.error("Failed to render /today", err instanceof Error ? err.message : err);
      await ctx.reply("Sorry, I couldn't load today's schedule. Please try again in a moment.");
    }
  });
}
