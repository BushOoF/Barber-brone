/**
 * Voice-note handler.
 *
 * Flow (Project 2 — remote AI):
 *   voice note -> download .ogg via grammY (getFile + fetch file_path URL)
 *             -> POST multipart to the REMOTE worker (ai/client)
 *             -> validate the returned tool + arguments
 *             -> store a pending action keyed by user
 *             -> reply with a Confirm / Cancel inline keyboard
 * NEVER commits to the DB here — that happens only on the Confirm tap.
 */
import type { Bot, Context } from "grammy";
import { env } from "../../env.js";
import { logger } from "../../lib/logger.js";
import { processVoice, AiServiceError } from "../../ai/client.js";
import { AddClientArgs, AddWalkinArgs, CreateBreakArgs } from "../../ai/types.js";
import { resolveBarber } from "../barber.js";
import { putPending } from "../pending.js";
import { confirmKeyboard, describePending } from "../format.js";

const NOT_ADMIN =
  "This bot is private to the barbershop staff. Ask the owner to add your Telegram ID to ADMIN_TELEGRAM_IDS.";

const MAX_OGG_BYTES = 8 * 1024 * 1024; // sanity cap; a voice note is normally well under this

/** Map an AiServiceError to a friendly message for the barber. */
function aiErrorMessage(err: AiServiceError): string {
  switch (err.kind) {
    case "timeout":
      return "⌛ The AI service took too long to answer. The local worker or its tunnel may be busy or offline — please try again in a moment.";
    case "unreachable":
      return "📡 I can't reach the AI service right now (the tunnel to the local worker looks down). Please try again shortly.";
    case "unauthorized":
      return "🔒 The AI service rejected my request (shared-secret mismatch). Please tell the admin to check WORKER_SHARED_SECRET on both sides.";
    case "server_error":
      return "⚠️ The AI service hit an internal error processing the audio. Please try recording again, a little more clearly.";
    case "bad_response":
    default:
      return "🤔 I couldn't understand the AI service's reply. Please try again.";
  }
}

export function registerVoiceHandler(bot: Bot): void {
  // Telegram sends both `voice` (OGG/Opus) and, sometimes, `audio`. Handle voice.
  bot.on("message:voice", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const barber = await resolveBarber(userId);
    if (!barber) {
      await ctx.reply(NOT_ADMIN);
      return;
    }

    const voice = ctx.message?.voice;
    if (!voice) return;
    if (voice.file_size && voice.file_size > MAX_OGG_BYTES) {
      await ctx.reply("That voice note is too large for me to process. Please send a shorter one.");
      return;
    }

    // Let the barber know we're working (STT + LLM over a tunnel takes a beat).
    await ctx.replyWithChatAction("typing").catch(() => {});

    let audio: ArrayBuffer;
    try {
      const file = await ctx.getFile(); // file.file_path is set for downloadable files
      if (!file.file_path) throw new Error("Telegram did not return a file_path");
      const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`Telegram file download failed: HTTP ${dl.status}`);
      audio = await dl.arrayBuffer();
    } catch (err) {
      logger.error("Failed to download voice note", err instanceof Error ? err.message : err);
      await ctx.reply("I couldn't download that voice note from Telegram. Please try again.");
      return;
    }

    let result;
    try {
      result = await processVoice(audio, { mime: voice.mime_type ?? "audio/ogg", filename: "voice.ogg" });
    } catch (err) {
      if (err instanceof AiServiceError) {
        await ctx.reply(aiErrorMessage(err));
      } else {
        logger.error("Unexpected AI client error", err instanceof Error ? err.message : err);
        await ctx.reply("Something went wrong talking to the AI service. Please try again.");
      }
      return;
    }

    if (result.tool === "none") {
      await ctx.reply(
        "🤷 I couldn't tell what you wanted. Try something like:\n• \"Add client Aziz, 90 123 45 67\"\n• \"Break from 13:00 to 14:00\"\n• \"Walk-in now for 30 minutes\"",
      );
      return;
    }

    // Validate the per-tool arguments. The worker is trusted but we still verify
    // the shape before we ever act on it.
    let action: Parameters<typeof putPending>[1] | null = null;
    if (result.tool === "add_client") {
      const args = AddClientArgs.safeParse(result.arguments);
      if (args.success) action = { barberId: barber.id, kind: "add_client", args: args.data };
    } else if (result.tool === "create_break") {
      const args = CreateBreakArgs.safeParse(result.arguments);
      if (args.success) action = { barberId: barber.id, kind: "create_break", args: args.data };
    } else if (result.tool === "add_walkin") {
      const args = AddWalkinArgs.safeParse(result.arguments);
      if (args.success) action = { barberId: barber.id, kind: "add_walkin", args: args.data };
    }

    if (!action) {
      logger.warn("AI returned a tool with invalid arguments", { tool: result.tool });
      await ctx.reply("I understood the request but some details were unclear. Please try again, speaking the time/phone clearly.");
      return;
    }

    const stored = putPending(userId, action);
    const summary = describePending(stored);
    const lowConfNote = result.confidence < 0.5 ? "\n\n_(I'm not fully sure I heard that right — please double-check.)_" : "";
    await ctx.reply(`Please confirm:\n\n*${escapeMd(summary)}*${lowConfNote}`, {
      parse_mode: "Markdown",
      reply_markup: confirmKeyboard(stored.id),
    });
  });
}

/** Minimal Markdown escaping for the summary line. */
function escapeMd(s: string): string {
  return s.replace(/([*_`\[\]])/g, "\\$1");
}
