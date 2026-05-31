/**
 * Voice scheduling for the main bot.
 *
 * voice/audio note -> download -> AI sidecar (role-aware, direct audio->Gemma) ->
 * confirm card in the user's language -> on Confirm, commit via the existing
 * services (booking / break / walk-in / cancel / announcement / settings).
 *
 * Roles:
 *   - customer (default)       -> book_appointment, cancel_booking
 *   - staff (ADMIN/APPRENTICE) -> create_break, add_walkin, cancel_break,
 *        cancel_booking, make_announcement, update_service, update_hours, add_vacation
 */
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { DEFAULT_LANG, t, type Lang } from "../lib/i18n.js";
import { formatLocalTime, todayKey } from "../lib/time.js";
import { postVoice, AiServiceError, type VoiceRole, type VoiceResult, type VoiceTool } from "../ai/voice-client.js";
import * as actions from "../services/voice-actions.js";

// ---- pending-action store (TTL, owner-scoped) ----
interface PendingAction {
  ownerId: number;
  lang: Lang;
  role: VoiceRole;
  userId: string;
  barberId?: string;
  tool: VoiceTool;
  args: Record<string, unknown>;
  createdAt: number;
}

const PENDING_TTL_MS = 5 * 60_000;
const pending = new Map<string, PendingAction>();
let seq = 0;

function putPending(a: PendingAction): string {
  const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  pending.set(id, a);
  return id;
}
function takePending(id: string): PendingAction | undefined {
  const a = pending.get(id);
  if (a) pending.delete(id);
  return a;
}
function sweep(): void {
  const now = Date.now();
  for (const [id, a] of pending) if (now - a.createdAt > PENDING_TTL_MS) pending.delete(id);
}

const CUSTOMER_TOOLS: VoiceTool[] = ["book_appointment", "cancel_booking"];
const STAFF_TOOLS: VoiceTool[] = [
  "create_break",
  "add_walkin",
  "cancel_break",
  "cancel_booking",
  "make_announcement",
  "update_service",
  "update_hours",
  "add_vacation",
];

// ---- arg helpers ----
const sStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const sNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const toMin = (v: unknown): number | null => {
  const s = sStr(v);
  return s ? actions.hhmmToMinutes(s) : null;
};

function resolveUser(tgId: number) {
  return prisma.user.findUnique({ where: { telegramId: BigInt(tgId) }, include: { barberProfile: true } });
}

function confirmKb(lang: Lang, id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "voice.btn_confirm"), `vc:confirm:${id}`)
    .text(t(lang, "voice.btn_cancel"), `vc:cancel:${id}`);
}

function todayAnchor(): string {
  const tk = todayKey();
  const [y, m, d] = tk.split("-").map(Number);
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  ];
  return `${tk} (${wd})`;
}

function dateLabel(lang: Lang, token: unknown): string {
  const d = sStr(token)?.toLowerCase();
  if (!d || d === "today") return t(lang, "voice.today");
  if (d === "tomorrow") return t(lang, "voice.tomorrow");
  return d;
}

function whenSuffix(lang: Lang, args: Record<string, unknown>): string {
  const parts: string[] = [];
  const dt = sStr(args.date);
  const tm = sStr(args.time) ?? sStr(args.start_time);
  if (dt) parts.push(dateLabel(lang, dt));
  if (tm) parts.push(tm);
  return parts.length ? ` (${parts.join(" ")})` : "";
}

/** Build a localized one-line summary for the confirm card, or null if not actionable. */
function summarize(lang: Lang, tool: VoiceTool, a: Record<string, unknown>): string | null {
  switch (tool) {
    case "book_appointment":
      return sStr(a.when) === "time" && sStr(a.time)
        ? t(lang, "voice.sum_book_time", { date: dateLabel(lang, a.date), time: sStr(a.time)! })
        : t(lang, "voice.sum_book_asap");
    case "cancel_booking":
      return t(lang, "voice.sum_cancel_book") + whenSuffix(lang, a);
    case "create_break": {
      const s = sStr(a.start_time);
      const e = sStr(a.end_time);
      if (!s || !e) return null;
      const base = t(lang, "voice.sum_break", { start: s, end: e });
      const dt = sStr(a.date);
      return dt && dt !== "today" ? `${dateLabel(lang, dt)} • ${base}` : base;
    }
    case "add_walkin": {
      const st = sStr(a.start_time) ?? t(lang, "voice.now");
      return t(lang, "voice.sum_walkin", { start: st, dur: sNum(a.duration_min) ?? 30 });
    }
    case "cancel_break":
      return t(lang, "voice.sum_cancel_break") + whenSuffix(lang, a);
    case "make_announcement": {
      const msg = sStr(a.message);
      if (!msg) return null;
      return t(lang, "voice.sum_announce", { msg: msg.length > 140 ? msg.slice(0, 140) + "…" : msg });
    }
    case "update_service": {
      const svc = sStr(a.service);
      if (!svc) return null;
      const ch: string[] = [];
      const price = sNum(a.price);
      const dur = sNum(a.duration_min);
      if (price != null) ch.push(`${price}`);
      if (dur != null) ch.push(`${dur} min`);
      return t(lang, "voice.sum_service", { service: svc, changes: ch.join(", ") });
    }
    case "update_hours": {
      const o = sStr(a.open);
      const c = sStr(a.close);
      if (!o && !c) return null;
      const hours = o && c ? `${o}–${c}` : o ? `${o}→` : `→${c}`;
      return t(lang, "voice.sum_hours", { hours });
    }
    case "add_vacation": {
      const dt = sStr(a.date);
      if (!dt) return null;
      return t(lang, "voice.sum_vacation", { date: dateLabel(lang, dt) });
    }
    default:
      return null;
  }
}

/** Execute a confirmed action and reply with the localized result. */
async function commit(p: PendingAction, reply: (text: string, md?: boolean) => Promise<void>): Promise<void> {
  const lang = p.lang;
  const a = p.args;
  switch (p.tool) {
    case "book_appointment": {
      const when =
        sStr(a.when) === "time" && sStr(a.time)
          ? ({ when: "time", time: sStr(a.time)!, date: sStr(a.date) } as const)
          : ({ when: "asap" } as const);
      const r = await actions.bookForCustomer(p.userId, when);
      if (!r.ok) {
        await reply(t(lang, r.reason === "no_slot" ? "voice.no_slot" : r.reason === "slot_taken" ? "voice.slot_taken" : "voice.failed"));
        return;
      }
      await reply(t(lang, "voice.booked", { time: formatLocalTime(r.startAt) }), true);
      return;
    }
    case "cancel_booking": {
      const r =
        p.role === "staff"
          ? await actions.cancelBookingForBarber(p.barberId!, toMin(a.time), sStr(a.date))
          : await actions.cancelBookingForCustomer(p.userId, toMin(a.time), sStr(a.date));
      if (!r.ok) {
        await reply(t(lang, r.reason === "ambiguous" ? "voice.ambiguous" : "voice.nothing"));
        return;
      }
      await reply(t(lang, "voice.booking_cancelled", { time: formatLocalTime(r.startAt) }));
      return;
    }
    case "create_break": {
      const s = toMin(a.start_time);
      const e = toMin(a.end_time);
      if (s == null || e == null) {
        await reply(t(lang, "voice.failed"));
        return;
      }
      const r = await actions.createBreakForBarber(p.barberId!, s, e, sStr(a.date), sStr(a.note));
      await reply(t(lang, "voice.break_done", { start: formatLocalTime(r.startAt), end: formatLocalTime(r.endAt) }));
      return;
    }
    case "add_walkin": {
      const r = await actions.createWalkInForBarber(p.barberId!, toMin(a.start_time), sNum(a.duration_min) ?? 30, sStr(a.note));
      await reply(t(lang, "voice.walkin_done", { start: formatLocalTime(r.startAt) }));
      return;
    }
    case "cancel_break": {
      const r = await actions.cancelBreakForBarber(p.barberId!, toMin(a.start_time), sStr(a.date));
      if (!r.ok) {
        await reply(t(lang, r.reason === "ambiguous" ? "voice.ambiguous" : "voice.nothing"));
        return;
      }
      await reply(t(lang, "voice.break_cancelled", { start: r.start, end: r.end }));
      return;
    }
    case "make_announcement": {
      const msg = sStr(a.message);
      if (!msg) {
        await reply(t(lang, "voice.failed"));
        return;
      }
      const r = await actions.makeAnnouncement(msg, p.userId);
      await reply(t(lang, "voice.announced", { delivered: r.delivered, recipients: r.recipients }));
      return;
    }
    case "update_service": {
      const svc = sStr(a.service);
      if (!svc) {
        await reply(t(lang, "voice.failed"));
        return;
      }
      const r = await actions.updateService(svc, sNum(a.price), sNum(a.duration_min));
      await reply(r.ok ? t(lang, "voice.service_updated", { name: r.name }) : t(lang, "voice.service_not_found"));
      return;
    }
    case "update_hours": {
      await actions.updateHours(toMin(a.open), toMin(a.close));
      await reply(t(lang, "voice.hours_updated"));
      return;
    }
    case "add_vacation": {
      const dt = sStr(a.date);
      if (!dt) {
        await reply(t(lang, "voice.failed"));
        return;
      }
      const r = await actions.addVacation(dt, sStr(a.note));
      await reply(t(lang, "voice.vacation_added", { date: r.dateKey }));
      return;
    }
    default:
      await reply(t(lang, "voice.failed"));
  }
}

export function registerVoiceHandlers(bot: Bot): void {
  setInterval(sweep, 60_000).unref();

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const user = await resolveUser(tgUser.id);
    const lang = ((user?.language ?? DEFAULT_LANG) as Lang);
    if (!user) {
      await ctx.reply(t(lang, "voice.need_phone"));
      return;
    }

    // Per-shop runtime toggle (operator bot: /voice <slug> on|off).
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { hasVoiceFeature: true },
    });
    if (settings && !settings.hasVoiceFeature) {
      await ctx.reply(t(lang, "voice.disabled"));
      return;
    }

    const isStaff = Boolean(
      (user.role === "ADMIN" || user.role === "APPRENTICE") && user.barberProfile?.isActive,
    );
    const voiceRole: VoiceRole = isStaff ? "staff" : "customer";
    if (isStaff && !user.barberProfile) {
      await ctx.reply(t(lang, "voice.no_barber"));
      return;
    }
    if (!isStaff && !user.phone) {
      await ctx.reply(t(lang, "voice.need_phone"));
      return;
    }

    await ctx.replyWithChatAction("typing").catch(() => {});

    let audio: Uint8Array;
    let mime = "audio/ogg";
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`telegram file download ${resp.status}`);
      audio = new Uint8Array(await resp.arrayBuffer());
      mime = ctx.message?.voice?.mime_type ?? ctx.message?.audio?.mime_type ?? mime;
    } catch (err) {
      console.error("voice download failed:", err);
      await ctx.reply(t(lang, "voice.failed"));
      return;
    }

    let res: VoiceResult;
    try {
      res = await postVoice(audio, mime, voiceRole, todayAnchor());
    } catch (err) {
      if (err instanceof AiServiceError) {
        console.error("voice AI unavailable:", err.message);
        await ctx.reply(t(lang, "voice.unavailable"));
      } else {
        console.error("voice processing error:", err);
        await ctx.reply(t(lang, "voice.failed"));
      }
      return;
    }

    const heard = res.transcript ? t(lang, "voice.heard", { heard: res.transcript }) : "";
    const allowed = voiceRole === "customer" ? CUSTOMER_TOOLS : STAFF_TOOLS;
    const summary = allowed.includes(res.tool) ? summarize(lang, res.tool, res.arguments) : null;
    if (!summary) {
      await ctx.reply(t(lang, "voice.not_understood", { heard: res.transcript || "" }));
      return;
    }

    const id = putPending({
      ownerId: tgUser.id,
      lang,
      role: voiceRole,
      userId: user.id,
      barberId: user.barberProfile?.id,
      tool: res.tool,
      args: res.arguments,
      createdAt: Date.now(),
    });
    await ctx.reply(`${t(lang, "voice.confirm_title")}\n\n${summary}${heard}`, {
      parse_mode: "Markdown",
      reply_markup: confirmKb(lang, id),
    });
  });

  bot.callbackQuery(/^vc:(confirm|cancel):(.+)$/, async (ctx) => {
    const tgUser = ctx.from;
    const verb = ctx.match![1];
    const id = ctx.match![2];
    if (!tgUser) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (verb === "cancel") {
      const p = id ? takePending(id) : undefined;
      const lang = p?.lang ?? ((((await resolveUser(tgUser.id))?.language) ?? DEFAULT_LANG) as Lang);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply(t(lang, "voice.cancelled"));
      return;
    }

    const p = takePending(id);
    if (!p) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }
    if (p.ownerId !== tgUser.id) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    const reply = async (text: string, md?: boolean): Promise<void> => {
      await ctx.reply(text, md ? { parse_mode: "Markdown" } : {});
    };
    try {
      await commit(p, reply);
    } catch (err) {
      console.error("voice commit failed:", err);
      await ctx.reply(t(p.lang, "voice.failed"));
    }
  });
}
