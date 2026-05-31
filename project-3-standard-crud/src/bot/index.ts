/**
 * grammY bot: commands, inline-keyboard main menu, callback-query routing, and
 * a small step-by-step wizard backed by the in-memory session store.
 *
 * Auth: every interaction is gated on the admin allowlist (env) AND a matching
 * active Barber row. A non-admin gets a polite refusal and nothing else runs.
 */
import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { Barber } from "@prisma/client";
import { env, isAdmin } from "../env.js";
import {
  addClient,
  cancelAppointment,
  createAppointment,
  createBlock,
  getAppointmentById,
  getBarberByTelegramId,
  listDay,
  listRecentClients,
  listUpcomingAppointments,
  rescheduleAppointment,
  type Conflict,
} from "../scheduling.js";
import {
  formatDate,
  formatDateTime,
  formatTime,
  localDateKey,
  localDateTimeToUtc,
  localDayRange,
  parseLocalDateKey,
  startOfLocalDay,
  todayLocal,
} from "../time.js";
import {
  appointmentListKeyboard,
  appointmentShortLabel,
  clientChoiceKeyboard,
  clientLabel,
  confirmKeyboard,
  datePickerKeyboard,
  durationPickerKeyboard,
  mainMenuKeyboard,
  mainMenuText,
  renderAgenda,
  timePickerKeyboard,
  escapeMd,
  CB,
} from "./ui.js";
import { clearSession, getSession, startSession, updateSession } from "../wizard.js";

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/** Resolve the Barber row for the caller, or null if not authorized/active. */
async function resolveBarber(ctx: Context): Promise<Barber | null> {
  const from = ctx.from;
  if (!from) return null;
  if (!isAdmin(from.id)) return null;
  const barber = await getBarberByTelegramId(BigInt(from.id));
  if (!barber || !barber.isActive) return null;
  return barber;
}

bot.use(async (ctx, next) => {
  // Allow only allowlisted admins; everyone else gets one refusal line.
  if (!ctx.from) return; // ignore channel posts etc.
  if (!isAdmin(ctx.from.id)) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Not authorized.", show_alert: true }).catch(() => {});
    } else if (ctx.message) {
      await ctx.reply("⛔ This bot is private to the barbershop staff.").catch(() => {});
    }
    return;
  }
  await next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MD = { parse_mode: "Markdown" as const };

function describeConflict(conflict: Conflict): string {
  const when = `${formatTime(conflict.startAt)}–${formatTime(conflict.endAt)}`;
  if (conflict.kind === "appointment") {
    const a = conflict.appointment!;
    const who = a.client ? clientLabel(a.client) : a.isWalkIn ? "walk-in" : "another client";
    return `That overlaps an existing appointment ${when} (${who}).`;
  }
  const b = conflict.block!;
  const label = b.type === "BREAK" ? "a break" : b.type === "WALK_IN" ? "a walk-in block" : "a busy block";
  return `That overlaps ${label} ${when}.`;
}

/** Send the main menu (new message). */
async function sendMainMenu(ctx: Context, barber: Barber): Promise<void> {
  await ctx.reply(mainMenuText(barber.name), { ...MD, reply_markup: mainMenuKeyboard() });
}

/** Edit the current message into the main menu (used from callbacks). */
async function editToMainMenu(ctx: Context, barber: Barber): Promise<void> {
  try {
    await ctx.editMessageText(mainMenuText(barber.name), { ...MD, reply_markup: mainMenuKeyboard() });
  } catch {
    await sendMainMenu(ctx, barber);
  }
}

async function showAgenda(ctx: Context, barber: Barber, dateKey: string, edit: boolean): Promise<void> {
  const d = parseLocalDateKey(dateKey);
  if (!d) {
    await ctx.reply("Could not read that date.");
    return;
  }
  const range = localDayRange(d.year, d.month, d.day);
  const agenda = await listDay(barber.id, range);
  const label = formatDate(startOfLocalDay(d.year, d.month, d.day));
  const text = renderAgenda(label, agenda);
  const kb = new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`);
  if (edit) {
    await ctx.editMessageText(text, { ...MD, reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { ...MD, reply_markup: kb });
    });
  } else {
    await ctx.reply(text, { ...MD, reply_markup: kb });
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.command("start", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) {
    await ctx.reply(
      "⛔ Your Telegram ID is on the admin list but no active barber record exists.\n" +
        "Ask the operator to run the seed (`npm run db:seed`).",
    );
    return;
  }
  clearSession(ctx.from!.id);
  await ctx.reply(
    `Welcome, ${barber.name}! 💈\nManage your day from the menu below.`,
  );
  await sendMainMenu(ctx, barber);
});

bot.command("menu", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  clearSession(ctx.from!.id);
  await sendMainMenu(ctx, barber);
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "*Commands*",
      "`/menu` — open the main menu",
      "`/today` — today's agenda",
      "`/add` — add an appointment (step by step)",
      "`/break` — block off a break",
      "`/cancel` — cancel an appointment",
      "`/reschedule` — move an appointment",
      "",
      "Most actions are also reachable from the inline menu.",
    ].join("\n"),
    MD,
  );
});

bot.command("today", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  await showAgenda(ctx, barber, localDateKey(todayLocal()), false);
});

bot.command("add", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  await beginAddAppointment(ctx, barber);
});

bot.command("break", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  await beginAddBreak(ctx, barber);
});

bot.command("cancel", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  await beginCancel(ctx, barber, false);
});

bot.command("reschedule", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;
  await beginReschedule(ctx, barber, false);
});

// ---------------------------------------------------------------------------
// Flow starters (shared by commands + callbacks)
// ---------------------------------------------------------------------------

async function beginAddAppointment(ctx: Context, barber: Barber, edit = false): Promise<void> {
  const userId = ctx.from!.id;
  startSession(userId, { flow: "add_appt", step: "appt_client_choice", chatId: ctx.chat?.id });
  const recent = await listRecentClients(barber.id);
  const text = "*Add appointment* — who is it for?";
  const kb = clientChoiceKeyboard(recent);
  if (edit) {
    await ctx.editMessageText(text, { ...MD, reply_markup: kb }).catch(() => ctx.reply(text, { ...MD, reply_markup: kb }));
  } else {
    await ctx.reply(text, { ...MD, reply_markup: kb });
  }
}

async function beginAddBreak(ctx: Context, _barber: Barber, edit = false): Promise<void> {
  const userId = ctx.from!.id;
  startSession(userId, { flow: "add_break", step: "break_date", chatId: ctx.chat?.id });
  const text = "*Add break* — pick the day:";
  const kb = datePickerKeyboard(CB.addBreak);
  if (edit) {
    await ctx.editMessageText(text, { ...MD, reply_markup: kb }).catch(() => ctx.reply(text, { ...MD, reply_markup: kb }));
  } else {
    await ctx.reply(text, { ...MD, reply_markup: kb });
  }
}

async function beginCancel(ctx: Context, barber: Barber, edit = false): Promise<void> {
  clearSession(ctx.from!.id);
  const appts = await listUpcomingAppointments(barber.id, new Date());
  if (appts.length === 0) {
    const text = "Nothing upcoming to cancel.";
    const kb = new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`);
    if (edit) await ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }));
    else await ctx.reply(text, { reply_markup: kb });
    return;
  }
  const text = "*Cancel appointment* — pick one:";
  const kb = appointmentListKeyboard(CB.cancel, appts);
  if (edit) await ctx.editMessageText(text, { ...MD, reply_markup: kb }).catch(() => ctx.reply(text, { ...MD, reply_markup: kb }));
  else await ctx.reply(text, { ...MD, reply_markup: kb });
}

async function beginReschedule(ctx: Context, barber: Barber, edit = false): Promise<void> {
  clearSession(ctx.from!.id);
  const appts = await listUpcomingAppointments(barber.id, new Date());
  if (appts.length === 0) {
    const text = "Nothing upcoming to reschedule.";
    const kb = new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`);
    if (edit) await ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }));
    else await ctx.reply(text, { reply_markup: kb });
    return;
  }
  const text = "*Reschedule* — pick the appointment to move:";
  const kb = appointmentListKeyboard(CB.resched, appts);
  if (edit) await ctx.editMessageText(text, { ...MD, reply_markup: kb }).catch(() => ctx.reply(text, { ...MD, reply_markup: kb }));
  else await ctx.reply(text, { ...MD, reply_markup: kb });
}

// ---------------------------------------------------------------------------
// Callback-query routing
// ---------------------------------------------------------------------------

bot.on("callback_query:data", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) {
    await ctx.answerCallbackQuery({ text: "Not authorized.", show_alert: true });
    return;
  }
  const data = ctx.callbackQuery.data;
  const [ns, action, ...rest] = data.split(":");

  try {
    switch (ns) {
      case CB.menu:
        await ctx.answerCallbackQuery();
        clearSession(ctx.from.id);
        await editToMainMenu(ctx, barber);
        return;

      case CB.view:
        await ctx.answerCallbackQuery();
        await handleViewCb(ctx, barber, action, rest);
        return;

      case CB.addAppt:
        await handleAddApptCb(ctx, barber, action, rest);
        return;

      case CB.addBreak:
        await handleAddBreakCb(ctx, barber, action, rest);
        return;

      case CB.cancel:
        await handleCancelCb(ctx, barber, action, rest);
        return;

      case CB.resched:
        await handleReschedCb(ctx, barber, action, rest);
        return;

      case CB.noop:
        await ctx.answerCallbackQuery();
        return;

      default:
        await ctx.answerCallbackQuery({ text: "Unknown action." });
        return;
    }
  } catch (err) {
    console.error("[callback] handler error:", err);
    await ctx.answerCallbackQuery({ text: "Something went wrong. Try again.", show_alert: true }).catch(() => {});
  }
});

async function handleViewCb(ctx: Context, barber: Barber, action: string | undefined, _rest: string[]) {
  if (action === "today") {
    await showAgenda(ctx, barber, localDateKey(todayLocal()), true);
  }
}

async function handleAddApptCb(ctx: Context, barber: Barber, action: string | undefined, rest: string[]) {
  const userId = ctx.from!.id;
  switch (action) {
    case "start": {
      await ctx.answerCallbackQuery();
      await beginAddAppointment(ctx, barber, true);
      return;
    }
    case "walkin": {
      await ctx.answerCallbackQuery();
      updateSession(userId, { clientId: null, isWalkIn: true, step: "appt_date" });
      await ctx.editMessageText("*Add appointment* (walk-in) — pick the day:", {
        ...MD,
        reply_markup: datePickerKeyboard(CB.addAppt),
      });
      return;
    }
    case "newclient": {
      await ctx.answerCallbackQuery();
      updateSession(userId, { isWalkIn: false, step: "appt_client_name" });
      await ctx.editMessageText(
        "*New client* — send the client's *name* (or send `-` to skip):",
        MD,
      );
      return;
    }
    case "client": {
      await ctx.answerCallbackQuery();
      const clientId = rest[0];
      updateSession(userId, { clientId: clientId ?? null, isWalkIn: false, step: "appt_date" });
      await ctx.editMessageText("*Add appointment* — pick the day:", {
        ...MD,
        reply_markup: datePickerKeyboard(CB.addAppt),
      });
      return;
    }
    case "date": {
      await ctx.answerCallbackQuery();
      const dateKey = rest[0];
      if (!dateKey || !parseLocalDateKey(dateKey)) {
        await ctx.editMessageText("Bad date, please restart with /add.");
        return;
      }
      updateSession(userId, { dateKey, step: "appt_time" });
      await ctx.editMessageText(
        "*Pick a time* (or type one like `14:30`):",
        { ...MD, reply_markup: timePickerKeyboard(CB.addAppt) },
      );
      return;
    }
    case "time": {
      await ctx.answerCallbackQuery();
      const hhmm = rest.join(":"); // time has a colon, so rest = ["14","30"]
      updateSession(userId, { timeHHMM: hhmm, step: "appt_duration" });
      await ctx.editMessageText(`Time *${hhmm}* — pick a duration:`, {
        ...MD,
        reply_markup: durationPickerKeyboard(CB.addAppt),
      });
      return;
    }
    case "dur": {
      await ctx.answerCallbackQuery();
      const dur = Number(rest[0]);
      updateSession(userId, { durationMin: dur, step: "appt_note" });
      await ctx.editMessageText(
        `Duration *${dur} min*.\nAdd a note? Send text, or tap Skip.`,
        {
          ...MD,
          reply_markup: new InlineKeyboard()
            .text("Skip note", `${CB.addAppt}:skipnote`)
            .row()
            .text("« Back to menu", `${CB.menu}:open`),
        },
      );
      return;
    }
    case "skipnote": {
      await ctx.answerCallbackQuery();
      updateSession(userId, { note: null });
      await finalizeAppointment(ctx, barber);
      return;
    }
    default:
      await ctx.answerCallbackQuery({ text: "Unknown step." });
  }
}

async function handleAddBreakCb(ctx: Context, _barber: Barber, action: string | undefined, rest: string[]) {
  const userId = ctx.from!.id;
  switch (action) {
    case "start": {
      await ctx.answerCallbackQuery();
      await beginAddBreak(ctx, _barber, true);
      return;
    }
    case "date": {
      await ctx.answerCallbackQuery();
      const dateKey = rest[0];
      if (!dateKey || !parseLocalDateKey(dateKey)) {
        await ctx.editMessageText("Bad date, please restart with /break.");
        return;
      }
      updateSession(userId, { dateKey, step: "break_start" });
      await ctx.editMessageText("Break — *start time*? Pick or type `HH:MM`:", {
        ...MD,
        reply_markup: timePickerKeyboard(CB.addBreak),
      });
      return;
    }
    case "time": {
      // First time tap = start, second = end (depends on current step).
      await ctx.answerCallbackQuery();
      const hhmm = rest.join(":");
      const s = getSession(userId);
      if (!s) {
        await ctx.editMessageText("Session expired. Start again with /break.");
        return;
      }
      if (s.step === "break_start") {
        updateSession(userId, { breakStartHHMM: hhmm, step: "break_end" });
        await ctx.editMessageText(`Start *${hhmm}* — now the *end time*:`, {
          ...MD,
          reply_markup: timePickerKeyboard(CB.addBreak),
        });
      } else {
        updateSession(userId, { breakEndHHMM: hhmm });
        await finalizeBreak(ctx, _barber);
      }
      return;
    }
    default:
      await ctx.answerCallbackQuery({ text: "Unknown step." });
  }
}

async function handleCancelCb(ctx: Context, barber: Barber, action: string | undefined, rest: string[]) {
  switch (action) {
    case "list": {
      await ctx.answerCallbackQuery();
      await beginCancel(ctx, barber, true);
      return;
    }
    case "pick": {
      await ctx.answerCallbackQuery();
      const id = rest[0];
      if (!id) return;
      const appt = await getAppointmentById(id);
      if (!appt || appt.barberId !== barber.id || appt.status === "CANCELLED") {
        await ctx.editMessageText("That appointment is no longer available.", {
          reply_markup: new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`),
        });
        return;
      }
      await ctx.editMessageText(
        `Cancel this appointment?\n\n*${escapeMd(formatDateTime(appt.startAt))}*\n${escapeMd(appointmentShortLabel(appt))}`,
        { ...MD, reply_markup: confirmKeyboard(`${CB.cancel}:confirm:${id}`, `${CB.menu}:open`) },
      );
      return;
    }
    case "confirm": {
      const id = rest[0];
      if (!id) {
        await ctx.answerCallbackQuery();
        return;
      }
      const appt = await getAppointmentById(id);
      if (!appt || appt.barberId !== barber.id) {
        await ctx.answerCallbackQuery({ text: "Not found." });
        return;
      }
      await cancelAppointment(id);
      await ctx.answerCallbackQuery({ text: "Cancelled." });
      await ctx.editMessageText(
        `❌ Cancelled: *${escapeMd(formatDateTime(appt.startAt))}* — ${escapeMd(appointmentShortLabel(appt))}`,
        { ...MD, reply_markup: new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`) },
      );
      return;
    }
    default:
      await ctx.answerCallbackQuery({ text: "Unknown step." });
  }
}

async function handleReschedCb(ctx: Context, barber: Barber, action: string | undefined, rest: string[]) {
  const userId = ctx.from!.id;
  switch (action) {
    case "list": {
      await ctx.answerCallbackQuery();
      await beginReschedule(ctx, barber, true);
      return;
    }
    case "pick": {
      await ctx.answerCallbackQuery();
      const id = rest[0];
      if (!id) return;
      const appt = await getAppointmentById(id);
      if (!appt || appt.barberId !== barber.id || appt.status === "CANCELLED") {
        await ctx.editMessageText("That appointment is no longer available.", {
          reply_markup: new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`),
        });
        return;
      }
      startSession(userId, {
        flow: "reschedule",
        step: "resched_date",
        appointmentId: id,
        chatId: ctx.chat?.id,
      });
      await ctx.editMessageText(
        `Rescheduling *${escapeMd(appointmentShortLabel(appt))}*.\nPick the new day:`,
        { ...MD, reply_markup: datePickerKeyboard(CB.resched) },
      );
      return;
    }
    case "date": {
      await ctx.answerCallbackQuery();
      const dateKey = rest[0];
      if (!dateKey || !parseLocalDateKey(dateKey)) {
        await ctx.editMessageText("Bad date, please restart with /reschedule.");
        return;
      }
      updateSession(userId, { dateKey, step: "resched_time" });
      await ctx.editMessageText("Pick the new *time* (or type `HH:MM`):", {
        ...MD,
        reply_markup: timePickerKeyboard(CB.resched),
      });
      return;
    }
    case "time": {
      await ctx.answerCallbackQuery();
      const hhmm = rest.join(":");
      updateSession(userId, { timeHHMM: hhmm });
      await finalizeReschedule(ctx, barber);
      return;
    }
    default:
      await ctx.answerCallbackQuery({ text: "Unknown step." });
  }
}

// ---------------------------------------------------------------------------
// Finalizers
// ---------------------------------------------------------------------------

async function finalizeAppointment(ctx: Context, barber: Barber): Promise<void> {
  const userId = ctx.from!.id;
  const s = getSession(userId);
  if (!s || !s.dateKey || !s.timeHHMM || !s.durationMin) {
    await ctx.reply("Session expired or incomplete. Start again with /add.");
    clearSession(userId);
    return;
  }
  const date = parseLocalDateKey(s.dateKey)!;
  let startAt: Date;
  try {
    startAt = localDateTimeToUtc(date, s.timeHHMM);
  } catch {
    await replyWizard(ctx, "That time looked invalid. Send a time like `14:30`.");
    updateSession(userId, { step: "appt_time" });
    return;
  }

  const result = await createAppointment({
    barberId: barber.id,
    clientId: s.clientId ?? null,
    startAt,
    durationMin: s.durationMin,
    isWalkIn: s.isWalkIn ?? false,
    note: s.note ?? null,
    source: "MANUAL",
  });

  if (!result.ok) {
    await replyWizard(
      ctx,
      `⚠️ ${describeConflict(result.conflict)}\n\nPick a different time:`,
      timePickerKeyboard(CB.addAppt),
    );
    updateSession(userId, { step: "appt_time" });
    return;
  }

  clearSession(userId);
  const a = result.appointment;
  const who = a.client ? clientLabel(a.client) : a.isWalkIn ? "walk-in" : "no client";
  await replyWizard(
    ctx,
    `✅ Booked *${escapeMd(formatDateTime(a.startAt))}–${escapeMd(formatTime(a.endAt))}*\nClient: ${escapeMd(who)}${a.note ? `\nNote: _${escapeMd(a.note)}_` : ""}`,
    new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`),
  );
}

async function finalizeBreak(ctx: Context, barber: Barber): Promise<void> {
  const userId = ctx.from!.id;
  const s = getSession(userId);
  if (!s || !s.dateKey || !s.breakStartHHMM || !s.breakEndHHMM) {
    await ctx.reply("Session expired or incomplete. Start again with /break.");
    clearSession(userId);
    return;
  }
  const date = parseLocalDateKey(s.dateKey)!;
  let startAt: Date;
  let endAt: Date;
  try {
    startAt = localDateTimeToUtc(date, s.breakStartHHMM);
    endAt = localDateTimeToUtc(date, s.breakEndHHMM);
  } catch {
    await replyWizard(ctx, "Those times looked invalid. Start again with /break.");
    clearSession(userId);
    return;
  }
  if (endAt.getTime() <= startAt.getTime()) {
    await replyWizard(
      ctx,
      "End time must be after start time. Pick the *end time* again:",
      timePickerKeyboard(CB.addBreak),
    );
    updateSession(userId, { step: "break_end" });
    return;
  }

  const { block, overlapping } = await createBlock({
    barberId: barber.id,
    startAt,
    endAt,
    type: "BREAK",
    note: s.note ?? null,
  });

  clearSession(userId);
  let text = `☕ Break added *${escapeMd(formatTime(block.startAt))}–${escapeMd(formatTime(block.endAt))}* on ${escapeMd(formatDate(block.startAt))}.`;
  if (overlapping.length > 0) {
    text += `\n\n⚠️ Heads up — it overlaps ${overlapping.length} existing appointment(s):`;
    for (const a of overlapping) {
      text += `\n• ${escapeMd(appointmentShortLabel(a))}`;
    }
    text += `\n\nThey were *not* cancelled. Use ❌ Cancel if you need to clear them.`;
  }
  await replyWizard(ctx, text, new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`));
}

async function finalizeReschedule(ctx: Context, barber: Barber): Promise<void> {
  const userId = ctx.from!.id;
  const s = getSession(userId);
  if (!s || !s.appointmentId || !s.dateKey || !s.timeHHMM) {
    await ctx.reply("Session expired or incomplete. Start again with /reschedule.");
    clearSession(userId);
    return;
  }
  const date = parseLocalDateKey(s.dateKey)!;
  let newStartAt: Date;
  try {
    newStartAt = localDateTimeToUtc(date, s.timeHHMM);
  } catch {
    await replyWizard(ctx, "That time looked invalid. Send a time like `14:30`.");
    updateSession(userId, { step: "resched_time" });
    return;
  }

  const result = await rescheduleAppointment(s.appointmentId, newStartAt);
  if (!result.ok) {
    if (result.reason === "not_found") {
      clearSession(userId);
      await replyWizard(
        ctx,
        "That appointment no longer exists.",
        new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`),
      );
      return;
    }
    // conflict
    await replyWizard(
      ctx,
      `⚠️ ${describeConflict(result.conflict)}\n\nPick a different time:`,
      timePickerKeyboard(CB.resched),
    );
    updateSession(userId, { step: "resched_time" });
    return;
  }

  clearSession(userId);
  const a = result.appointment;
  await replyWizard(
    ctx,
    `🔁 Moved to *${escapeMd(formatDateTime(a.startAt))}* — ${escapeMd(appointmentShortLabel(a))}`,
    new InlineKeyboard().text("« Back to menu", `${CB.menu}:open`),
  );
}

/**
 * Reply for a wizard step. We send a NEW message (rather than edit) because the
 * triggering update may be a text message, not a callback on an editable bubble.
 */
async function replyWizard(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await ctx.reply(text, { ...MD, ...(keyboard ? { reply_markup: keyboard } : {}) });
}

// ---------------------------------------------------------------------------
// Free-text input — only meaningful while a wizard expects typed input.
// ---------------------------------------------------------------------------

bot.on("message:text", async (ctx) => {
  const barber = await resolveBarber(ctx);
  if (!barber) return;

  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return; // commands handled above

  const userId = ctx.from.id;
  const s = getSession(userId);
  if (!s) {
    // Idle text → nudge to the menu.
    await sendMainMenu(ctx, barber);
    return;
  }

  switch (s.step) {
    case "appt_client_name": {
      const name = text === "-" ? null : text.slice(0, 80);
      updateSession(userId, { newClientName: name, step: "appt_client_phone" });
      await replyWizard(ctx, "Send the client's *phone* (or `-` to skip):");
      return;
    }
    case "appt_client_phone": {
      const phone = text === "-" ? null : normalizePhone(text);
      const client = await addClient({ name: s.newClientName ?? null, phone });
      updateSession(userId, { clientId: client.id, isWalkIn: false, step: "appt_date" });
      await replyWizard(
        ctx,
        `Client saved: *${escapeMd(clientLabel(client))}*.\nPick the day:`,
        datePickerKeyboard(CB.addAppt),
      );
      return;
    }
    case "appt_time": {
      updateSession(userId, { timeHHMM: text, step: "appt_duration" });
      await replyWizard(ctx, `Time *${escapeMd(text)}* — pick a duration:`, durationPickerKeyboard(CB.addAppt));
      return;
    }
    case "appt_note": {
      updateSession(userId, { note: text.slice(0, 200) });
      await finalizeAppointment(ctx, barber);
      return;
    }
    case "break_start": {
      updateSession(userId, { breakStartHHMM: text, step: "break_end" });
      await replyWizard(ctx, `Start *${escapeMd(text)}* — now the *end time*:`, timePickerKeyboard(CB.addBreak));
      return;
    }
    case "break_end": {
      updateSession(userId, { breakEndHHMM: text });
      await finalizeBreak(ctx, barber);
      return;
    }
    case "resched_time": {
      updateSession(userId, { timeHHMM: text });
      await finalizeReschedule(ctx, barber);
      return;
    }
    default: {
      // Steps that expect a button tap, not text.
      await replyWizard(ctx, "Please use the buttons above, or /menu to start over.");
      return;
    }
  }
});

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  // Keep a leading +, strip spaces, dashes, parens.
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  return cleaned.slice(0, 24) || trimmed.slice(0, 24);
}

// ---------------------------------------------------------------------------
// Global error boundary
// ---------------------------------------------------------------------------

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  console.error(`[bot] error while handling update ${ctx.update.update_id}:`);
  if (e instanceof GrammyError) {
    console.error("  Telegram API error:", e.description);
  } else if (e instanceof HttpError) {
    console.error("  network error contacting Telegram:", e);
  } else {
    console.error("  ", e);
  }
});
