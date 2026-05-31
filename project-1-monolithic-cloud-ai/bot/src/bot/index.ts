/**
 * Telegram bot wiring (grammY, long-polling by default).
 *
 * Commands:
 *   /start  — greet + admin gate
 *   /today  — the barber's agenda for today (appointments + blocks)
 *
 * Voice flow:
 *   voice note -> download .ogg -> POST to AI sidecar -> validate tool call ->
 *   store pending action -> reply with a human summary + Confirm/Cancel buttons.
 *   The DB write happens ONLY when the barber taps Confirm.
 */
import { Bot, InlineKeyboard, type Context } from "grammy";
import { env, isAdmin } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { processVoice, AiServiceError } from "../ai/client.js";
import { parseToolCall, type PendingAction } from "./actions.js";
import { putPending, takePending, sweepExpired } from "./pending.js";
import {
  addClient,
  createAppointment,
  createBlock,
  listDay,
  type Conflict,
} from "../services/scheduling.js";
import {
  formatTime,
  localDateTimeToUtc,
  todayInShopTz,
  startOfLocalDayUtc,
  endOfLocalDayUtc,
} from "../lib/time.js";

const DEFAULT_WALKIN_MIN = 30;

/** Resolve the active Barber row for a Telegram user, or null. */
async function getBarber(telegramId: number) {
  return prisma.barber.findFirst({
    where: { telegramId: BigInt(telegramId), isActive: true },
  });
}

type BarberRow = NonNullable<Awaited<ReturnType<typeof getBarber>>>;

/** Guard: ensure the sender is a seeded, active admin barber. Replies if not. */
async function requireBarber(ctx: Context): Promise<BarberRow | null> {
  const uid = ctx.from?.id;
  if (uid === undefined || !isAdmin(uid)) {
    await ctx.reply("Sorry, this bot is only for the shop's barbers.");
    return null;
  }
  const barber = await getBarber(uid);
  if (!barber) {
    await ctx.reply(
      "Your Telegram ID is allow-listed but no barber record exists yet. Ask the admin to run the seed (npm run db:seed)."
    );
    return null;
  }
  return barber;
}

// ---------------------------------------------------------------------------
// Confirmation summaries + keyboards
// ---------------------------------------------------------------------------

/** Human-readable summary of a pending action shown above the buttons. */
function summarize(action: PendingAction): string {
  switch (action.tool) {
    case "add_client": {
      const name = action.args.name ? ` (${action.args.name})` : "";
      return `Add client: ${action.args.phone}${name}`;
    }
    case "create_break":
      return `Block break ${action.args.start_time}–${action.args.end_time}${
        action.args.note ? ` — ${action.args.note}` : ""
      }`;
    case "add_walkin": {
      const start = action.args.start_time ?? "now";
      const dur = action.args.duration_min ?? DEFAULT_WALKIN_MIN;
      return `Add walk-in at ${start} for ${dur} min${action.args.note ? ` — ${action.args.note}` : ""}`;
    }
  }
}

function confirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", `confirm:${pendingId}`)
    .text("❌ Cancel", `cancel:${pendingId}`);
}

/** Format a scheduling conflict for the barber. */
function describeConflict(c: Conflict): string {
  const when = `${formatTime(c.startAt)}–${formatTime(c.endAt)}`;
  if (c.kind === "block") return `it overlaps an existing block (${when})`;
  const who = c.item.client?.name || c.item.client?.phone || (c.item.isWalkIn ? "walk-in" : "a client");
  return `it overlaps an appointment with ${who} (${when})`;
}

// ---------------------------------------------------------------------------
// Commit a confirmed action
// ---------------------------------------------------------------------------

async function commitAction(barberId: string, action: PendingAction): Promise<string> {
  const today = todayInShopTz();

  switch (action.tool) {
    case "add_client": {
      const client = await addClient({ phone: action.args.phone, name: action.args.name ?? null });
      const label = client.name ? `${client.name} (${client.phone})` : client.phone ?? "client";
      return `✅ Client saved: ${label}`;
    }

    case "create_break": {
      const startAt = localDateTimeToUtc(today, action.args.start_time);
      const endAt = localDateTimeToUtc(today, action.args.end_time);
      if (endAt.getTime() <= startAt.getTime()) {
        return "❌ The break's end time must be after its start time. Please try again.";
      }
      // Warn (but still create) if it overlaps scheduled appointments — we do
      // not auto-cancel. The barber already confirmed the break itself.
      const result = await createBlock({
        barberId,
        startAt,
        endAt,
        type: "BREAK",
        note: action.args.note ?? null,
      });
      let msg = `✅ Break blocked ${formatTime(startAt)}–${formatTime(endAt)}.`;
      if (result.overlappingAppointments.length > 0) {
        const lines = result.overlappingAppointments.map((a) => {
          const who = a.client?.name || a.client?.phone || (a.isWalkIn ? "walk-in" : "client");
          return `  • ${formatTime(a.startAt)} ${who}`;
        });
        msg +=
          `\n⚠️ Heads up — these appointments overlap the break (not cancelled):\n` + lines.join("\n");
      }
      return msg;
    }

    case "add_walkin": {
      const startAt = action.args.start_time
        ? localDateTimeToUtc(today, action.args.start_time)
        : new Date();
      const durationMin = action.args.duration_min ?? DEFAULT_WALKIN_MIN;
      const res = await createAppointment({
        barberId,
        startAt,
        durationMin,
        isWalkIn: true,
        note: action.args.note ?? null,
        source: "VOICE",
      });
      if (!res.ok) {
        return `❌ Could not add the walk-in — ${describeConflict(res.conflict)}. Nothing was saved.`;
      }
      return `✅ Walk-in added at ${formatTime(res.appointment.startAt)} for ${durationMin} min.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Bot factory
// ---------------------------------------------------------------------------

export function createBot(): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // ---- /start ----
  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined || !isAdmin(uid)) {
      await ctx.reply("Hi! This is a private barbershop scheduling bot.");
      return;
    }
    await ctx.reply(
      [
        "✂️ Barber scheduling bot ready.",
        "",
        "Commands:",
        "• /today — your agenda for today",
        "",
        "Or just send a voice note, e.g.:",
        '• "Client raqami 90 123 45 67" (add a client)',
        '• "Soat 13 dan 14 gacha tanaffus" (block a break)',
        '• "Hozir mijoz keldi" (add a walk-in)',
        "",
        "I'll show a summary and ask you to Confirm before saving.",
      ].join("\n")
    );
  });

  // ---- /today ----
  bot.command("today", async (ctx) => {
    const barber = await requireBarber(ctx);
    if (!barber) return;

    const today = todayInShopTz();
    const agenda = await listDay(
      barber.id,
      startOfLocalDayUtc(today),
      endOfLocalDayUtc(today)
    );

    if (agenda.appointments.length === 0 && agenda.blocks.length === 0) {
      await ctx.reply("📅 Today: nothing scheduled.");
      return;
    }

    // Merge and sort the day's items for a single chronological list.
    type Row = { at: Date; line: string };
    const rows: Row[] = [];
    for (const a of agenda.appointments) {
      const who = a.client?.name || a.client?.phone || (a.isWalkIn ? "walk-in" : "client");
      const tag = a.isWalkIn ? " (walk-in)" : "";
      const note = a.note ? ` — ${a.note}` : "";
      rows.push({
        at: a.startAt,
        line: `🧔 ${formatTime(a.startAt)}–${formatTime(a.endAt)} ${who}${tag}${note}`,
      });
    }
    for (const b of agenda.blocks) {
      const note = b.note ? ` — ${b.note}` : "";
      rows.push({
        at: b.startAt,
        line: `⛔ ${formatTime(b.startAt)}–${formatTime(b.endAt)} ${b.type.toLowerCase()}${note}`,
      });
    }
    rows.sort((x, y) => x.at.getTime() - y.at.getTime());

    await ctx.reply(`📅 Today (${env.SHOP_TZ}):\n` + rows.map((r) => r.line).join("\n"));
  });

  // ---- Voice handler ----
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const barber = await requireBarber(ctx);
    if (!barber) return;

    await ctx.replyWithChatAction("typing").catch(() => {});

    // 1) Download the audio file from Telegram.
    let audio: Uint8Array;
    let mime = "audio/ogg";
    try {
      const file = await ctx.getFile(); // works for voice & audio
      const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`Telegram file download failed: ${resp.status}`);
      audio = new Uint8Array(await resp.arrayBuffer());
      const voiceMime = ctx.message?.voice?.mime_type ?? ctx.message?.audio?.mime_type;
      if (voiceMime) mime = voiceMime;
    } catch (err) {
      console.error("Voice download failed:", err);
      await ctx.reply("⚠️ I couldn't download that audio. Please try sending it again.");
      return;
    }

    // 2) Ask the AI sidecar to transcribe + pick a tool.
    let result;
    try {
      result = await processVoice(audio, mime, "voice.ogg");
    } catch (err) {
      if (err instanceof AiServiceError) {
        console.error("AI service error:", err.message);
        await ctx.reply("⚠️ The voice assistant is unavailable right now. Please try again in a moment.");
      } else {
        console.error("Unexpected voice processing error:", err);
        await ctx.reply("⚠️ Something went wrong processing your voice note. Please try again.");
      }
      return;
    }

    // 3) Interpret the tool call.
    const outcome = parseToolCall(result.tool, result.arguments);
    if (outcome.ok === "none") {
      const heard = result.transcript ? `\n\nI heard: "${result.transcript}"` : "";
      await ctx.reply(
        `🤔 I couldn't tell what you wanted. Try: add a client (with a phone), block a break (with times), or add a walk-in.${heard}`
      );
      return;
    }
    if (outcome.ok === false) {
      const heard = result.transcript ? `\n\nI heard: "${result.transcript}"` : "";
      await ctx.reply(`⚠️ I understood the action but the details were off: ${outcome.reason}.${heard}`);
      return;
    }

    // 4) Store a pending action and ask for confirmation. (No DB write yet.)
    // Key on the Telegram user id (number) so the confirm/cancel handlers,
    // which read ctx.from.id, can verify ownership.
    const pendingId = putPending(ctx.from.id, outcome.action);
    const heard = result.transcript ? `\n\n_Heard:_ “${result.transcript}”` : "";
    await ctx.reply(`Please confirm:\n\n${summarize(outcome.action)}${heard}`, {
      reply_markup: confirmKeyboard(pendingId),
      parse_mode: "Markdown",
    });
  });

  // ---- Confirm ----
  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    const uid = ctx.from?.id;
    const pendingId = ctx.match?.[1];
    if (uid === undefined || !pendingId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const entry = takePending(pendingId);
    if (!entry) {
      await ctx.answerCallbackQuery({ text: "This request expired. Please record it again." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }
    if (entry.ownerId !== uid) {
      await ctx.answerCallbackQuery({ text: "This isn't your request." });
      return;
    }

    const barber = await getBarber(uid);
    if (!barber) {
      await ctx.answerCallbackQuery({ text: "No barber record found." });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Saving…" });
    let resultText: string;
    try {
      resultText = await commitAction(barber.id, entry.action);
    } catch (err) {
      console.error("Commit failed:", err);
      resultText = "❌ Something went wrong while saving. Please try again.";
    }
    // Drop the buttons and replace the message with the outcome.
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(resultText);
  });

  // ---- Cancel ----
  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const pendingId = ctx.match?.[1];
    if (pendingId) takePending(pendingId);
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply("❌ Cancelled. Nothing was saved.");
  });

  // ---- Global error boundary so one bad update can't crash the bot ----
  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  // Periodically clear expired pending actions.
  setInterval(() => sweepExpired(), 60_000).unref();

  return bot;
}
