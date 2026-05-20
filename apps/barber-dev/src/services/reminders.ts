import cron from "node-cron";
import { bot } from "../bot/index.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { listOperators } from "./operators.js";
import { ensureFeeRowsForMonth, pendingForMonth } from "./billing.js";
import { currentMonthKey, currentWeekKey, formatMinor } from "../lib/money.js";

async function safeBroadcast(text: string) {
  // Combine env operators + DB operators into one deduped list so newly-added ops also get pings.
  const envOps = env.OPERATOR_TELEGRAM_IDS;
  const dbOps = await listOperators();
  const ids = new Set<string>();
  for (const id of envOps) ids.add(id.toString());
  for (const op of dbOps) ids.add(op.telegramId.toString());

  for (const idStr of ids) {
    try {
      await bot.api.sendMessage(Number(idStr), text, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`[reminders] failed to message operator ${idStr}:`, err);
    }
  }
}

/** True if we already fired this kind of reminder during the current period. */
async function alreadyFired(kind: string): Promise<boolean> {
  const row = await prisma.reminderTick.findUnique({ where: { kind } });
  return !!row;
}

async function recordFired(kind: string) {
  await prisma.reminderTick.upsert({
    where: { kind },
    update: { firedAt: new Date() },
    create: { kind },
  });
}

export async function fireMonthlyBilling(force = false) {
  const monthKey = currentMonthKey();
  const tickKey = `monthly_billing:${monthKey}`;
  if (!force && (await alreadyFired(tickKey))) return;

  await ensureFeeRowsForMonth(monthKey);
  const pending = await pendingForMonth(monthKey);
  if (pending.length === 0) {
    // Still notify so the operator knows there's nothing to chase.
    await safeBroadcast(`📅 *${monthKey} billing reminder*\n\nNo shops owe anything this month. 🎉`);
  } else {
    const total = pending.reduce((s, p) => s + p.amountMinor, 0);
    const lines = [
      `📅 *${monthKey} billing reminder*`,
      "",
      "Time to collect monthly fees from these shops:",
      "",
    ];
    for (const p of pending) {
      lines.push(`🟡 *${p.shop.name}* (\`${p.shop.slug}\`) — ${formatMinor(p.amountMinor)}`);
    }
    lines.push("", `*Total owed:* ${formatMinor(total)}`);
    lines.push("", "Mark collected with `/collect <slug> [note]`.");
    await safeBroadcast(lines.join("\n"));
  }
  await recordFired(tickKey);
}

export async function fireWeeklyQuality(force = false) {
  const weekKey = currentWeekKey();
  const tickKey = `weekly_quality:${weekKey}`;
  if (!force && (await alreadyFired(tickKey))) return;

  await safeBroadcast(
    [
      "🛎 *Weekly quality check*",
      "",
      "Reach out to the shop owners this week and ask if everything is going smoothly:",
      "• Are clients showing up?",
      "• Is the apprentice flow useful (where enabled)?",
      "• Any feature requests or pain points?",
      "",
      "Use `/shops` for the contact list (owner Telegram IDs).",
    ].join("\n"),
  );
  await recordFired(tickKey);
}

/**
 * Schedules:
 *  - Day 1 of every month at 09:00 in TIMEZONE → monthly billing reminder
 *  - Every Monday at 09:00 in TIMEZONE → weekly quality reminder
 *
 * We also schedule a safety "drift" tick every hour that fires the reminders
 * lazily if the host was off when the canonical time passed. The alreadyFired
 * guard prevents double-pings within the same period.
 */
export function startReminderCrons() {
  const tz = env.TIMEZONE;

  cron.schedule("0 9 1 * *", () => void fireMonthlyBilling(), { timezone: tz });
  cron.schedule("0 9 * * 1", () => void fireWeeklyQuality(), { timezone: tz });

  // Lazy catch-up: every hour, check if we missed a period.
  cron.schedule("15 * * * *", async () => {
    try {
      const now = new Date();
      // Only "catch up" on the first day of the month and on Mondays — anywhere in the day.
      if (now.getUTCDate() === 1) await fireMonthlyBilling();
      if (now.getUTCDay() === 1) await fireWeeklyQuality();
    } catch (err) {
      console.error("[reminders] catch-up tick failed:", err);
    }
  });

  console.log(`✓ barber-dev reminder crons scheduled (timezone: ${tz})`);
}
