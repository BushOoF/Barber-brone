/** Build the grammY Bot, register handlers, set up an error boundary. */
import { Bot, GrammyError, HttpError } from "grammy";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import { registerCommands } from "./handlers/commands.js";
import { registerVoiceHandler } from "./handlers/voice.js";
import { registerCallbacks } from "./handlers/callbacks.js";

export function createBot(): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  registerCommands(bot);
  registerVoiceHandler(bot);
  registerCallbacks(bot);

  // Nudge non-admins / unsupported messages toward what the bot can do.
  bot.on("message:text", async (ctx) => {
    // Commands are handled above; this catches plain text only.
    if (ctx.message?.text?.startsWith("/")) return;
    await ctx.reply("Send me a voice note to add a client, break, or walk-in — or use /today.").catch(() => {});
  });

  // Global error boundary so one bad update never crashes the long-poller.
  bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error(`Telegram API error (update ${ctx.update.update_id})`, e.description);
    } else if (e instanceof HttpError) {
      logger.error(`Could not reach Telegram (update ${ctx.update.update_id})`, e.message);
    } else {
      logger.error(`Unhandled error (update ${ctx.update.update_id})`, e instanceof Error ? e.stack : e);
    }
  });

  return bot;
}
