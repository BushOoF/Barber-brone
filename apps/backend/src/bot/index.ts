import { Bot, GrammyError, HttpError } from "grammy";
import { env, isAdminTelegramId, mainBarberTelegramId } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { DEFAULT_LANG, languageButtons, t, type Lang } from "../lib/i18n.js";

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

function webAppButtonMarkup(label: string) {
  return {
    inline_keyboard: [[{ text: label, web_app: { url: env.WEBAPP_URL } }]],
  };
}

function contactRequestKeyboard(lang: Lang) {
  return {
    keyboard: [[{ text: t(lang, "bot.share_phone_btn"), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function locationRequestKeyboard(lang: Lang) {
  return {
    keyboard: [[{ text: t(lang, "bot.share_location_btn"), request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

async function getUserLang(telegramId: number | bigint): Promise<Lang> {
  const u = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { language: true },
  });
  return (u?.language ?? DEFAULT_LANG) as Lang;
}

bot.command("start", async (ctx) => {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const role = isAdminTelegramId(tgUser.id) ? "ADMIN" : "CUSTOMER";

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(tgUser.id) },
    update: {
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
    },
    create: {
      telegramId: BigInt(tgUser.id),
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
      role,
      language: DEFAULT_LANG,
    },
  });

  if (role === "ADMIN" && user.role === "CUSTOMER") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }

  const mainId = mainBarberTelegramId();
  if (mainId !== null && BigInt(tgUser.id) === mainId) {
    await prisma.barber.upsert({
      where: { userId: user.id },
      update: { isActive: true },
      create: {
        userId: user.id,
        role: "MAIN",
        displayName: tgUser.first_name ?? "Main Barber",
        isActive: true,
      },
    });
  }

  const lang = (user.language ?? DEFAULT_LANG) as Lang;

  if (!user.phone) {
    await ctx.reply(t(lang, "bot.welcome"), {
      reply_markup: contactRequestKeyboard(lang),
    });
    return;
  }

  await sendMainMenu(ctx.chat.id, lang, role === "ADMIN");
});

bot.on("message:contact", async (ctx) => {
  const tgUser = ctx.from;
  const contact = ctx.message.contact;
  if (!tgUser || !contact) return;

  const lang = await getUserLang(tgUser.id);

  if (contact.user_id && contact.user_id !== tgUser.id) {
    await ctx.reply(t(lang, "bot.contact_wrong"), {
      parse_mode: "Markdown",
      reply_markup: contactRequestKeyboard(lang),
    });
    return;
  }

  await prisma.user.update({
    where: { telegramId: BigInt(tgUser.id) },
    data: { phone: contact.phone_number },
  });

  const isAdmin = isAdminTelegramId(tgUser.id);
  await ctx.reply(t(lang, "bot.contact_thanks"), {
    reply_markup: { remove_keyboard: true },
  });
  await sendMainMenu(ctx.chat.id, lang, isAdmin);
});

bot.command("help", async (ctx) => {
  const lang = ctx.from ? await getUserLang(ctx.from.id) : DEFAULT_LANG;
  await ctx.reply(t(lang, "bot.help"));
});

bot.command("location", async (ctx) => {
  const tgUser = ctx.from;
  if (!tgUser) return;
  const lang = await getUserLang(tgUser.id);
  if (!isAdminTelegramId(tgUser.id)) {
    await ctx.reply(t(lang, "bot.location_admin_only"));
    return;
  }
  await ctx.reply(t(lang, "bot.location_prompt"), {
    reply_markup: locationRequestKeyboard(lang),
  });
});

bot.on("message:location", async (ctx) => {
  const tgUser = ctx.from;
  const loc = ctx.message.location;
  if (!tgUser || !loc) return;
  const lang = await getUserLang(tgUser.id);
  if (!isAdminTelegramId(tgUser.id)) {
    // Silently ignore — only the barber sets the shop location.
    await ctx.reply(t(lang, "bot.location_admin_only"), {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { locationLat: loc.latitude, locationLng: loc.longitude },
  });
  await ctx.reply(
    t(lang, "bot.location_saved", { lat: loc.latitude.toFixed(6), lng: loc.longitude.toFixed(6) }),
    { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } },
  );
});

bot.command("language", async (ctx) => {
  const lang = ctx.from ? await getUserLang(ctx.from.id) : DEFAULT_LANG;
  await ctx.reply(t(lang, "bot.language_prompt"), {
    reply_markup: { inline_keyboard: languageButtons() },
  });
});

bot.callbackQuery(/^lang:(UZ|RU|EN)$/, async (ctx) => {
  const newLang = ctx.match![1] as Lang;
  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.answerCallbackQuery();
    return;
  }
  await prisma.user.upsert({
    where: { telegramId: BigInt(tgUser.id) },
    update: { language: newLang },
    create: {
      telegramId: BigInt(tgUser.id),
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
      language: newLang,
    },
  });
  await ctx.answerCallbackQuery({ text: t(newLang, "bot.language_set") });
  try {
    await ctx.editMessageText(t(newLang, "bot.language_set"));
  } catch {
    // Message too old / already edited; ignore.
  }
  // Re-show the menu in the new language.
  const isAdmin = isAdminTelegramId(tgUser.id);
  if (ctx.chat) await sendMainMenu(ctx.chat.id, newLang, isAdmin);
});

async function sendMainMenu(chatId: number, lang: Lang, isAdmin: boolean) {
  const label = t(lang, isAdmin ? "bot.open_dashboard" : "bot.book_haircut");
  await bot.api.sendMessage(chatId, t(lang, "bot.menu_prompt"), {
    reply_markup: webAppButtonMarkup(label),
  });
}

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Bot error in update ${ctx?.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Telegram API error:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Network error:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

async function registerCommands() {
  // Per-language bot command menus so the slash autocomplete in each chat matches the user's language.
  const sets: Array<{ lang: Lang; code: "uz" | "ru" | "en" }> = [
    { lang: "UZ", code: "uz" },
    { lang: "RU", code: "ru" },
    { lang: "EN", code: "en" },
  ];
  // English as global default (covers all other locales)
  await bot.api.setMyCommands([
    { command: "start", description: "Open the booking menu" },
    { command: "language", description: "Change language" },
    { command: "location", description: "Set shop location (barber only)" },
    { command: "help", description: "Help" },
  ]);
  const descUz = { start: "Yozilishni boshlash", language: "Tilni o'zgartirish", location: "Sartaroshxona joylashuvi", help: "Yordam" };
  const descRu = { start: "Открыть меню записи", language: "Изменить язык", location: "Адрес парикмахерской", help: "Помощь" };
  for (const s of sets) {
    const d = s.lang === "UZ"
      ? descUz
      : s.lang === "RU"
      ? descRu
      : { start: "Open the booking menu", language: "Change language", location: "Set shop location", help: "Help" };
    try {
      await bot.api.setMyCommands(
        [
          { command: "start", description: d.start },
          { command: "language", description: d.language },
          { command: "location", description: d.location },
          { command: "help", description: d.help },
        ],
        { language_code: s.code },
      );
    } catch {
      // Telegram occasionally rejects language_code for unknown codes; ignore.
    }
  }
}

export async function startBot() {
  await registerCommands();
  if (env.TELEGRAM_WEBHOOK_URL) {
    await bot.api.setWebhook(env.TELEGRAM_WEBHOOK_URL, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ["message", "callback_query"],
    });
    console.log(`✓ Telegram webhook registered at ${env.TELEGRAM_WEBHOOK_URL}`);
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    bot.start({
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
      onStart: (info) => console.log(`✓ Telegram bot @${info.username} started (long-polling)`),
    });
  }
}
