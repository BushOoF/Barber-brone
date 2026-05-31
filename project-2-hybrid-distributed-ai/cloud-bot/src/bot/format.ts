/**
 * Human-readable summaries and inline keyboards for confirmations.
 * Callback data is namespaced and carries the pending-action id:
 *   "confirm:<id>" / "cancel:<id>"
 */
import { InlineKeyboard } from "grammy";
import { env } from "../env.js";
import type { Conflict, DaySchedule } from "../scheduling/service.js";
import { formatDate, formatTime } from "../lib/tz.js";
import type { PendingAction } from "./pending.js";

export function confirmKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", `confirm:${id}`)
    .text("✖️ Cancel", `cancel:${id}`);
}

/** A short, readable description of what will happen if the barber confirms. */
export function describePending(action: PendingAction): string {
  switch (action.kind) {
    case "add_client": {
      const namePart = action.args.name ? ` ${action.args.name}` : "";
      return `Add client${namePart} — ${action.args.phone}`;
    }
    case "create_break": {
      const note = action.args.note ? `\nNote: ${action.args.note}` : "";
      return `Add a break ${action.args.start_time}–${action.args.end_time}${note}`;
    }
    case "add_walkin": {
      const start = action.args.start_time ?? "now";
      const dur = action.args.duration_min ?? 30;
      const note = action.args.note ? `\nNote: ${action.args.note}` : "";
      return `Add a walk-in at ${start} for ${dur} min${note}`;
    }
  }
}

/** Render the /today schedule for display. */
export function renderDay(day: DaySchedule, when: Date): string {
  const tz = env.SHOP_TZ;
  const header = `🗓 ${formatDate(when, tz)} (${tz})`;

  type Row = { start: Date; end: Date; line: string };
  const rows: Row[] = [];

  for (const a of day.appointments) {
    const who = a.client?.name
      ? a.client.name
      : a.client?.phone
        ? a.client.phone
        : a.isWalkIn
          ? "walk-in"
          : "client";
    const tag = a.isWalkIn ? " (walk-in)" : "";
    const note = a.note ? ` — ${a.note}` : "";
    rows.push({
      start: a.startAt,
      end: a.endAt,
      line: `🧔 ${formatTime(a.startAt, tz)}–${formatTime(a.endAt, tz)} ${who}${tag}${note}`,
    });
  }
  for (const b of day.blocks) {
    const label = b.type === "BREAK" ? "Break" : b.type === "WALK_IN" ? "Walk-in slot" : "Busy";
    const note = b.note ? ` — ${b.note}` : "";
    rows.push({
      start: b.startAt,
      end: b.endAt,
      line: `⛔ ${formatTime(b.startAt, tz)}–${formatTime(b.endAt, tz)} ${label}${note}`,
    });
  }

  rows.sort((x, y) => x.start.getTime() - y.start.getTime());

  if (rows.length === 0) {
    return `${header}\n\nNothing scheduled. Enjoy the quiet ✂️`;
  }
  return `${header}\n\n${rows.map((r) => r.line).join("\n")}`;
}

/** Explain a scheduling conflict to the barber. */
export function describeConflict(conflict: Conflict): string {
  const tz = env.SHOP_TZ;
  const span = `${formatTime(conflict.startAt, tz)}–${formatTime(conflict.endAt, tz)}`;
  if (conflict.kind === "APPOINTMENT") {
    const who = conflict.clientName || conflict.clientPhone || (conflict.isWalkIn ? "walk-in" : "a client");
    return `⛔ That overlaps an existing appointment (${who}) at ${span}.`;
  }
  const label =
    conflict.blockType === "BREAK" ? "a break" : conflict.blockType === "WALK_IN" ? "a walk-in slot" : "a busy block";
  return `⛔ That overlaps ${label} at ${span}.`;
}
