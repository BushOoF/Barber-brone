import { Bot, GrammyError, HttpError } from "grammy";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { formatMinor, currentMonthKey } from "../lib/money.js";
import {
  isOperator,
  isSuperOperator,
  listOperators,
  addOperator,
  removeOperator,
} from "../services/operators.js";
import {
  listShops,
  findShopBySlug,
  createShop,
  setShopFee,
  setShopActive,
  setControlApprentice,
  setControlLocation,
} from "../services/shops.js";
import {
  ensureFeeRowsForMonth,
  markCollected,
  pendingForMonth,
  statusForShop,
} from "../services/billing.js";
import { getMonthlyRevenue } from "../services/revenue.js";
import {
  setShopApprenticeFeature,
  setShopVoiceFeature,
  setShopLocation,
  getShopSnapshot,
} from "../lib/shop-db.js";

export const bot = new Bot(env.BARBER_DEV_BOT_TOKEN);

const HELP_TEXT = [
  "*Barber-dev operator bot*",
  "",
  "*Shops*",
  "/shops — list all shops with current-month status",
  "/shop <slug> — detail view for one shop",
  "/addshop <slug> <name> <ownerTgId> [dbUrl] — register a new shop",
  "/setfee <slug> <amount> — set monthly fee (in shop's minor units)",
  "/collect <slug> [note] — mark this month's fee as collected",
  "/disable <slug> — pause a shop (no billing, hidden from lists)",
  "/enable <slug> — re-enable a shop",
  "",
  "*Per-shop features* (writes to the shop's own DB)",
  "/apprentice <slug> on|off — toggle apprentice feature in the shop's Mini App",
  "/voice <slug> on|off — toggle the voice AI assistant for the shop",
  "/location <slug> <address> — set/update the shop's address",
  "",
  "*Operators*",
  "/operators — list everyone who can use this bot",
  "/addop <telegramId> [name] — add operator (super only)",
  "/removeop <telegramId> — remove operator (super only)",
  "",
  "*Reminders*",
  "/billing — preview this month's pending fees",
  "",
  "/help — this message",
].join("\n");

// ---------- middleware: auth gate ----------

bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  if (!(await isOperator(ctx.from.id))) {
    await ctx.reply(
      "This bot is restricted to authorized operators. If you should have access, message the super operator.",
    );
    return;
  }
  await next();
});

// ---------- helpers ----------

function fmtShopHeader(s: { slug: string; name: string; isActive: boolean; monthlyFeeMinor: number; hasApprenticeFeature: boolean }) {
  const status = s.isActive ? "🟢" : "⚪";
  const apprenticeChip = s.hasApprenticeFeature ? " · 👥" : "";
  return `${status} *${s.name}* \`${s.slug}\`${apprenticeChip}\nFee: ${formatMinor(s.monthlyFeeMinor)}`;
}

// ---------- /start + /help ----------

bot.command(["start", "help"], async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});

// ---------- shops ----------

bot.command("shops", async (ctx) => {
  const shops = await listShops();
  if (shops.length === 0) {
    await ctx.reply(
      "No shops registered yet. Add one with:\n`/addshop <slug> <name> <ownerTgId> [dbUrl]`",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const monthKey = currentMonthKey();
  const lines: string[] = [`*Shops — ${monthKey}*`, ""];
  for (const s of shops) {
    const rev = s.dbUrl ? await getMonthlyRevenue(s.id, s.dbUrl, monthKey) : null;
    const fee = await statusForShop(s.id, monthKey);
    const feeChip =
      !fee ? "—" : fee.status === "COLLECTED" ? "✅" : fee.status === "WAIVED" ? "🚫" : "🟡";
    const revText = rev
      ? `${formatMinor(rev.revenueMinor)} (${rev.bookingsCount} bookings${rev.noShows ? `, ${rev.noShows} no-shows` : ""})`
      : "_no DB_";
    lines.push(`${fmtShopHeader(s)}\nRevenue: ${revText}\nFee status: ${feeChip} ${fee?.status ?? "no row"}`);
    lines.push("");
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("shop", async (ctx) => {
  const slug = (ctx.match ?? "").trim();
  if (!slug) {
    await ctx.reply("Usage: `/shop <slug>`", { parse_mode: "Markdown" });
    return;
  }
  const s = await findShopBySlug(slug);
  if (!s) {
    await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" });
    return;
  }
  const monthKey = currentMonthKey();
  const rev = s.dbUrl ? await getMonthlyRevenue(s.id, s.dbUrl, monthKey) : null;
  const fee = await statusForShop(s.id, monthKey);
  const snapshot = s.dbUrl ? await getShopSnapshot(s.dbUrl).catch(() => null) : null;

  const out: string[] = [];
  out.push(fmtShopHeader(s));
  out.push(`Owner TG: \`${s.ownerTelegramId}\`${s.ownerUsername ? ` (@${s.ownerUsername})` : ""}`);
  if (s.botUsername) out.push(`Bot: @${s.botUsername}`);
  out.push(`Location: ${s.location ?? snapshot?.location ?? "—"}`);
  out.push(`DB: ${s.dbUrl ? "✅ configured" : "❌ missing — set with /addshop or directly in the control DB"}`);
  out.push("");
  out.push(`*${monthKey} revenue:* ${rev ? formatMinor(rev.revenueMinor) : "—"}`);
  out.push(`*${monthKey} fee:* ${formatMinor(s.monthlyFeeMinor)} — ${fee?.status ?? "no row"}`);
  if (fee?.collectedAt) out.push(`  collected ${fee.collectedAt.toISOString().slice(0, 10)}${fee.note ? ` (${fee.note})` : ""}`);

  await ctx.reply(out.join("\n"), { parse_mode: "Markdown" });
});

bot.command("addshop", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply("Usage: `/addshop <slug> <name> <ownerTelegramId> [dbUrl]`", { parse_mode: "Markdown" });
    return;
  }
  const [slug, ...rest] = parts;
  const ownerIdStr = rest[rest.length - 2] || rest[rest.length - 1];
  const maybeDbUrl = /^postgres/i.test(rest[rest.length - 1]) ? rest[rest.length - 1] : undefined;
  // name = all parts between slug and ownerId (and dbUrl if present)
  const nameEnd = maybeDbUrl ? rest.length - 2 : rest.length - 1;
  const name = rest.slice(0, nameEnd).join(" ");
  const ownerId = parts.find((p) => /^\d+$/.test(p));

  if (!name || !ownerId) {
    await ctx.reply("Could not parse arguments. Format: `/addshop slug Shop Name 123456789 [postgres://...]`", { parse_mode: "Markdown" });
    return;
  }

  try {
    const shop = await createShop({
      slug,
      name,
      ownerTelegramId: BigInt(ownerId),
      dbUrl: maybeDbUrl,
    });
    await ctx.reply(`✅ Registered *${shop.name}* (\`${shop.slug}\`). Use /shop ${shop.slug} for details.`, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Failed: ${(err as Error).message}`);
  }
});

bot.command("setfee", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Usage: `/setfee <slug> <amount>`", { parse_mode: "Markdown" });
    return;
  }
  const [slug, amountStr] = parts;
  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount < 0) {
    await ctx.reply("Amount must be a non-negative integer.");
    return;
  }
  const shop = await findShopBySlug(slug);
  if (!shop) {
    await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" });
    return;
  }
  await setShopFee(slug, amount);
  await ctx.reply(`✅ Fee for *${shop.name}* set to ${formatMinor(amount)}.`, { parse_mode: "Markdown" });
});

bot.command("collect", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 1 || !parts[0]) {
    await ctx.reply("Usage: `/collect <slug> [note]`", { parse_mode: "Markdown" });
    return;
  }
  const [slug, ...noteParts] = parts;
  const note = noteParts.join(" ") || undefined;
  const shop = await findShopBySlug(slug);
  if (!shop) {
    await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" });
    return;
  }
  const monthKey = currentMonthKey();
  try {
    const updated = await markCollected(shop.id, monthKey, note);
    await ctx.reply(
      `✅ Marked ${formatMinor(updated.amountMinor)} as collected from *${shop.name}* for ${monthKey}.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    await ctx.reply(
      `No fee row for ${monthKey}. Run /billing first, or check that the shop has a non-zero fee set.`,
    );
  }
});

bot.command("disable", async (ctx) => {
  const slug = (ctx.match ?? "").trim();
  if (!slug) { await ctx.reply("Usage: `/disable <slug>`", { parse_mode: "Markdown" }); return; }
  const shop = await findShopBySlug(slug);
  if (!shop) { await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" }); return; }
  await setShopActive(slug, false);
  await ctx.reply(`⚪ *${shop.name}* disabled.`, { parse_mode: "Markdown" });
});

bot.command("enable", async (ctx) => {
  const slug = (ctx.match ?? "").trim();
  if (!slug) { await ctx.reply("Usage: `/enable <slug>`", { parse_mode: "Markdown" }); return; }
  const shop = await findShopBySlug(slug);
  if (!shop) { await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" }); return; }
  await setShopActive(slug, true);
  await ctx.reply(`🟢 *${shop.name}* re-enabled.`, { parse_mode: "Markdown" });
});

// ---------- per-shop feature toggles (write to shop's DB) ----------

bot.command("apprentice", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Usage: `/apprentice <slug> on|off`", { parse_mode: "Markdown" });
    return;
  }
  const [slug, state] = parts;
  const enabled = /^on|true|1|yes$/i.test(state);
  const shop = await findShopBySlug(slug);
  if (!shop) { await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" }); return; }
  if (!shop.dbUrl) { await ctx.reply(`No dbUrl on file for \`${slug}\` — set it before toggling features.`, { parse_mode: "Markdown" }); return; }

  try {
    await setShopApprenticeFeature(shop.dbUrl, enabled);
    await setControlApprentice(slug, enabled);
    await ctx.reply(
      `✅ Apprentice feature for *${shop.name}* is now *${enabled ? "ON" : "OFF"}*.\nThe shop's Mini App picks this up on next /api/me refresh.`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await ctx.reply(`Failed: ${(err as Error).message}`);
  }
});

bot.command("voice", async (ctx) => {
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Usage: `/voice <slug> on|off`", { parse_mode: "Markdown" });
    return;
  }
  const [slug, state] = parts;
  const enabled = /^on|true|1|yes$/i.test(state);
  const shop = await findShopBySlug(slug);
  if (!shop) { await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" }); return; }
  if (!shop.dbUrl) { await ctx.reply(`No dbUrl on file for \`${slug}\` — set it before toggling features.`, { parse_mode: "Markdown" }); return; }

  try {
    await setShopVoiceFeature(shop.dbUrl, enabled);
    await ctx.reply(
      `✅ Voice AI assistant for *${shop.name}* is now *${enabled ? "ON" : "OFF"}*.\n` +
        "_(The shop must also be deployed with VOICE_ENABLED=true and the AI sidecar running.)_",
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await ctx.reply(`Failed: ${(err as Error).message}`);
  }
});

bot.command("location", async (ctx) => {
  const text = (ctx.match ?? "").trim();
  const firstSpace = text.indexOf(" ");
  if (firstSpace === -1) {
    await ctx.reply("Usage: `/location <slug> <address>`", { parse_mode: "Markdown" });
    return;
  }
  const slug = text.slice(0, firstSpace);
  const address = text.slice(firstSpace + 1).trim();
  const shop = await findShopBySlug(slug);
  if (!shop) { await ctx.reply(`Shop \`${slug}\` not found.`, { parse_mode: "Markdown" }); return; }
  if (!shop.dbUrl) { await ctx.reply(`No dbUrl on file for \`${slug}\`.`, { parse_mode: "Markdown" }); return; }

  try {
    const newAddress = address || null;
    await setShopLocation(shop.dbUrl, newAddress);
    await setControlLocation(slug, newAddress);
    await ctx.reply(
      newAddress
        ? `✅ Location for *${shop.name}* updated.`
        : `✅ Location cleared for *${shop.name}*.`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    await ctx.reply(`Failed: ${(err as Error).message}`);
  }
});

// ---------- operators ----------

bot.command("operators", async (ctx) => {
  const ops = await listOperators();
  const lines = ["*Operators*", ""];
  if (ops.length === 0) {
    lines.push("_None registered in DB. Env operators only._");
  }
  for (const o of ops) {
    const badge = o.isSuper ? "👑" : "👤";
    const handle = o.username ? `@${o.username}` : "";
    const name = o.firstName ?? "";
    lines.push(`${badge} \`${o.telegramId}\` ${name} ${handle}`.trim());
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("addop", async (ctx) => {
  if (!ctx.from || !(await isSuperOperator(ctx.from.id))) {
    await ctx.reply("Only super operators can add other operators.");
    return;
  }
  const parts = (ctx.match ?? "").trim().split(/\s+/);
  if (parts.length < 1 || !/^\d+$/.test(parts[0])) {
    await ctx.reply("Usage: `/addop <telegramId> [name]`", { parse_mode: "Markdown" });
    return;
  }
  const [idStr, ...nameParts] = parts;
  const op = await addOperator(BigInt(idStr), nameParts.join(" ") || undefined);
  await ctx.reply(`✅ Added operator \`${op.telegramId}\`${op.firstName ? ` (${op.firstName})` : ""}.`, { parse_mode: "Markdown" });
});

bot.command("removeop", async (ctx) => {
  if (!ctx.from || !(await isSuperOperator(ctx.from.id))) {
    await ctx.reply("Only super operators can remove operators.");
    return;
  }
  const idStr = (ctx.match ?? "").trim();
  if (!/^\d+$/.test(idStr)) {
    await ctx.reply("Usage: `/removeop <telegramId>`", { parse_mode: "Markdown" });
    return;
  }
  const result = await removeOperator(BigInt(idStr));
  if (result.removed) {
    await ctx.reply(`✅ Removed operator \`${idStr}\`.`, { parse_mode: "Markdown" });
  } else if (result.reason === "is_super") {
    await ctx.reply("Cannot remove a super operator. Demote first (direct DB edit).");
  } else {
    await ctx.reply(`No operator with id \`${idStr}\`.`, { parse_mode: "Markdown" });
  }
});

// ---------- billing preview ----------

bot.command("billing", async (ctx) => {
  const monthKey = currentMonthKey();
  await ensureFeeRowsForMonth(monthKey);
  const pending = await pendingForMonth(monthKey);
  if (pending.length === 0) {
    await ctx.reply(`No PENDING fees for ${monthKey}. 🎉`);
    return;
  }
  const total = pending.reduce((s, p) => s + p.amountMinor, 0);
  const lines = [`*${monthKey} — PENDING fees*`, ""];
  for (const p of pending) {
    lines.push(`🟡 ${p.shop.name} (\`${p.shop.slug}\`) — ${formatMinor(p.amountMinor)}`);
  }
  lines.push("", `*Total owed:* ${formatMinor(total)}`);
  lines.push("", "Mark collected with `/collect <slug> [note]`.");
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

// ---------- error handler ----------

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[barber-dev] error in update ${ctx?.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) console.error("Telegram API:", e.description);
  else if (e instanceof HttpError) console.error("Network:", e);
  else console.error("Unknown:", e);
});

export async function startBot() {
  await bot.api.setMyCommands([
    { command: "shops", description: "List shops + status" },
    { command: "shop", description: "Detail for one shop" },
    { command: "billing", description: "This month's pending fees" },
    { command: "collect", description: "Mark fee as collected" },
    { command: "apprentice", description: "Toggle apprentice feature" },
    { command: "voice", description: "Toggle voice AI assistant" },
    { command: "location", description: "Set shop address" },
    { command: "operators", description: "List operators" },
    { command: "help", description: "Help" },
  ]);

  if (env.TELEGRAM_WEBHOOK_URL) {
    await bot.api.setWebhook(env.TELEGRAM_WEBHOOK_URL, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ["message", "callback_query"],
    });
    console.log(`✓ barber-dev webhook registered at ${env.TELEGRAM_WEBHOOK_URL}`);
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    bot.start({
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
      onStart: (info) => console.log(`✓ barber-dev bot @${info.username} started (long-polling)`),
    });
  }
}
