/**
 * Inline-keyboard builders and small text formatters for the bot UI.
 *
 * Callback-data convention: "<ns>:<action>[:<arg>...]". Telegram limits
 * callback_data to 64 bytes, so we keep namespaces short and use cuids (25
 * chars) only where unavoidable (client/appointment ids).
 */
import { InlineKeyboard } from "grammy";
import type { Appointment, Block, Client } from "@prisma/client";
import {
  addLocalDays,
  formatLocalDateShort,
  formatTime,
  localDateKey,
  todayLocal,
} from "../time.js";

export const CB = {
  menu: "m",
  view: "v",
  addAppt: "aa",
  addBreak: "ab",
  cancel: "ca",
  resched: "rs",
  noop: "noop",
} as const;

/** Main menu keyboard. */
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📅 View today", `${CB.view}:today`)
    .text("➕ Add appointment", `${CB.addAppt}:start`)
    .row()
    .text("☕ Add break", `${CB.addBreak}:start`)
    .row()
    .text("❌ Cancel appointment", `${CB.cancel}:list`)
    .text("🔁 Reschedule", `${CB.resched}:list`);
}

export function mainMenuText(barberName: string): string {
  return [
    `💈 *${escapeMd(barberName)}* — schedule manager`,
    "",
    "Choose an action below, or use commands:",
    "`/today` · `/add` · `/break` · `/cancel` · `/reschedule`",
  ].join("\n");
}

/** Date picker: today + next N days, plus a Back button. */
export function datePickerKeyboard(ns: string, days = 7): InlineKeyboard {
  const kb = new InlineKeyboard();
  const today = todayLocal();
  for (let i = 0; i < days; i++) {
    const d = addLocalDays(today, i);
    const label =
      i === 0 ? `Today (${formatLocalDateShort(d)})` : i === 1 ? `Tomorrow (${formatLocalDateShort(d)})` : formatLocalDateShort(d);
    kb.text(label, `${ns}:date:${localDateKey(d)}`);
    if (i % 2 === 1) kb.row();
  }
  kb.row().text("« Back to menu", `${CB.menu}:open`);
  return kb;
}

const COMMON_TIMES = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
];

/** Time picker grid. `ns:time:HH:MM`. Also reminds the user they can type. */
export function timePickerKeyboard(ns: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  COMMON_TIMES.forEach((t, idx) => {
    kb.text(t, `${ns}:time:${t}`);
    if (idx % 4 === 3) kb.row();
  });
  kb.row().text("« Back to menu", `${CB.menu}:open`);
  return kb;
}

const DURATIONS = [15, 30, 45, 60, 90];

export function durationPickerKeyboard(ns: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  DURATIONS.forEach((d, idx) => {
    kb.text(`${d} min`, `${ns}:dur:${d}`);
    if (idx % 3 === 2) kb.row();
  });
  kb.row().text("« Back to menu", `${CB.menu}:open`);
  return kb;
}

/** Yes/No confirmation. */
export function confirmKeyboard(yesData: string, noData: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confirm", yesData).text("✖️ Cancel", noData);
}

export function clientChoiceKeyboard(recent: Client[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("🚶 Walk-in (no client)", `${CB.addAppt}:walkin`).row();
  kb.text("➕ New client", `${CB.addAppt}:newclient`).row();
  for (const c of recent) {
    kb.text(`👤 ${clientLabel(c)}`, `${CB.addAppt}:client:${c.id}`).row();
  }
  kb.text("« Back to menu", `${CB.menu}:open`);
  return kb;
}

/** A list of appointments to act on (cancel / reschedule). */
export function appointmentListKeyboard(
  ns: string,
  appts: (Appointment & { client: Client | null })[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const a of appts) {
    kb.text(appointmentShortLabel(a), `${ns}:pick:${a.id}`).row();
  }
  kb.text("« Back to menu", `${CB.menu}:open`);
  return kb;
}

// ---------------------------------------------------------------------------
// Text formatters
// ---------------------------------------------------------------------------

export function clientLabel(c: Client): string {
  if (c.name && c.phone) return `${c.name} (${c.phone})`;
  if (c.name) return c.name;
  if (c.phone) return c.phone;
  return "client";
}

export function appointmentShortLabel(a: Appointment & { client: Client | null }): string {
  const who = a.client ? clientLabel(a.client) : a.isWalkIn ? "walk-in" : "no client";
  return `${formatTime(a.startAt)}–${formatTime(a.endAt)} · ${who}`;
}

/** Render the day agenda as Markdown text. */
export function renderAgenda(
  dateLabel: string,
  agenda: { appointments: (Appointment & { client: Client | null })[]; blocks: Block[] },
): string {
  const lines: string[] = [`📅 *${escapeMd(dateLabel)}*`, ""];

  type Row = { start: Date; text: string };
  const rows: Row[] = [];

  for (const a of agenda.appointments) {
    const who = a.client ? clientLabel(a.client) : a.isWalkIn ? "walk-in" : "no client";
    const tag = a.isWalkIn ? " 🚶" : "";
    const note = a.note ? ` — _${escapeMd(a.note)}_` : "";
    rows.push({
      start: a.startAt,
      text: `🟢 ${formatTime(a.startAt)}–${formatTime(a.endAt)} ${escapeMd(who)}${tag}${note}`,
    });
  }
  for (const b of agenda.blocks) {
    const label = b.type === "BREAK" ? "Break" : b.type === "WALK_IN" ? "Walk-in" : "Busy";
    const note = b.note ? ` — _${escapeMd(b.note)}_` : "";
    rows.push({
      start: b.startAt,
      text: `⛔ ${formatTime(b.startAt)}–${formatTime(b.endAt)} ${label}${note}`,
    });
  }

  rows.sort((x, y) => x.start.getTime() - y.start.getTime());

  if (rows.length === 0) {
    lines.push("_Nothing scheduled. Enjoy the quiet._");
  } else {
    for (const r of rows) lines.push(r.text);
  }
  return lines.join("\n");
}

/** Escape Telegram "Markdown" (legacy) special chars in dynamic text. */
export function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}
