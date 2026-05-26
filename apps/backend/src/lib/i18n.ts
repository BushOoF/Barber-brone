/**
 * Server-side translations for bot messages + customer-facing notifications.
 *
 * Keys are flat, dotted. Variables substituted with {name}. Markdown allowed
 * (Telegram parses it). Keep this in lockstep with apps/webapp/src/lib/i18n.ts.
 */

export type Lang = "UZ" | "RU" | "EN";

export const DEFAULT_LANG: Lang = "UZ";

const STRINGS = {
  UZ: {
    "bot.welcome":
      "Sartaroshxonaga xush kelibsiz! 💈\n\nYozilish uchun telefon raqamingiz kerak — pastdagi tugmani bosing.",
    "bot.share_phone_btn": "📱 Telefon raqamimni yuborish",
    "bot.contact_thanks": "Rahmat! Hammasi tayyor. ✂️",
    "bot.contact_wrong": "Iltimos, *o'z* raqamingizni pastdagi tugma orqali yuboring.",
    "bot.menu_prompt": "Davom etish uchun pastdagi tugmani bosing 👇",
    "bot.open_dashboard": "Boshqaruv panelini ochish",
    "bot.book_haircut": "Soch oldirish",
    "bot.help":
      "Yozilish ilovasini ochish uchun menyu tugmasini bosing.\n\nBuyruqlar:\n/start — qayta boshlash\n/language — tilni o'zgartirish\n/help — yordam",
    "bot.language_prompt": "Tilni tanlang:",
    "bot.language_set": "Til o'rnatildi ✅",
    "bot.share_location_btn": "📍 Sartaroshxona joylashuvini yuborish",
    "bot.location_prompt":
      "Sartaroshxonangizning joylashuvini yuboring — mijozlar yozuv tasdiqlash xabarida xaritada ko'rishi mumkin.\n\nPastdagi tugmani bosing 👇",
    "bot.location_admin_only": "Faqat sartarosh sartaroshxona joylashuvini belgilashi mumkin.",
    "bot.location_saved":
      "✅ Joylashuv saqlandi.\n\nKoordinatalar: `{lat}, {lng}`\nMijozlar yozuv tasdiqlash xabarida xaritadan ko'rishi mumkin.",

    "notify.reminder_will": "Vaqtingizdan 15 daqiqa oldin eslatamiz.",
    "notify.reminders_off": "Bu yozuv uchun eslatma o'chirilgan.",
    "notify.confirmed":
      "✅ *Yozuv tasdiqlandi*\n\nSartarosh: {barber}\nVaqt: *{time}*\nDavomiyligi: {dur} daq\nJami: {total}{location}\n\n{rem}",
    "notify.location_line": "\n📍 *Manzil:* {location}",
    "notify.shifted_earlier":
      "🎉 *Yaxshi xabar!* Vaqt bo'shab qoldi — yozuvingiz {old} dan *{new}* ga ko'chirildi. Erta keling.",
    "notify.shifted_later":
      "🙏 *Jadval o'zgardi* — yozuvingiz {old} dan *{new}* ga ko'chirildi. Noqulaylik uchun uzr!",
    "notify.transferred":
      "ℹ️ {time} dagi yozuvingiz *{oldBarber}* dan *{newBarber}* ga o'tkazildi.",
    "notify.reminder":
      "⏰ *Eslatma* — yozuvingiz *{time}* da (taxminan 15 daqiqada).\nKo'rishguncha! ✂️",

    "service.haircut_adult": "Soch olish (Katta)",
    "service.haircut_child": "Soch olish (Bola)",
    "service.wash": "Soch yuvish",
    "service.beard": "Soqol olish",
  },

  RU: {
    "bot.welcome":
      "Добро пожаловать в парикмахерскую! 💈\n\nДля записи нужен ваш номер — нажмите кнопку ниже, чтобы поделиться им.",
    "bot.share_phone_btn": "📱 Поделиться номером",
    "bot.contact_thanks": "Спасибо! Всё готово. ✂️",
    "bot.contact_wrong": "Пожалуйста, поделитесь *своим* номером с помощью кнопки ниже.",
    "bot.menu_prompt": "Нажмите кнопку ниже, чтобы продолжить 👇",
    "bot.open_dashboard": "Открыть панель",
    "bot.book_haircut": "Записаться на стрижку",
    "bot.help":
      "Нажмите кнопку меню, чтобы открыть приложение.\n\nКоманды:\n/start — начать\n/language — изменить язык\n/help — справка",
    "bot.language_prompt": "Выберите язык:",
    "bot.language_set": "Язык установлен ✅",
    "bot.share_location_btn": "📍 Отправить адрес парикмахерской",
    "bot.location_prompt":
      "Отправьте координаты парикмахерской — клиенты увидят их на карте в сообщении-подтверждении записи.\n\nНажмите кнопку ниже 👇",
    "bot.location_admin_only": "Только мастер может задать адрес парикмахерской.",
    "bot.location_saved":
      "✅ Адрес сохранён.\n\nКоординаты: `{lat}, {lng}`\nКлиенты увидят их на карте в подтверждении записи.",

    "notify.reminder_will": "Напомним за 15 минут до записи.",
    "notify.reminders_off": "Напоминания для этой записи отключены.",
    "notify.confirmed":
      "✅ *Запись подтверждена*\n\nМастер: {barber}\nВремя: *{time}*\nДлительность: {dur} мин\nИтого: {total}{location}\n\n{rem}",
    "notify.location_line": "\n📍 *Адрес:* {location}",
    "notify.shifted_earlier":
      "🎉 *Хорошие новости!* Освободилось время — ваша запись перенесена с {old} на *{new}*. Можно прийти раньше.",
    "notify.shifted_later":
      "🙏 *Изменение графика* — ваша запись перенесена с {old} на *{new}*. Извините за неудобства!",
    "notify.transferred":
      "ℹ️ Ваша запись на {time} переведена с *{oldBarber}* на *{newBarber}*.",
    "notify.reminder":
      "⏰ *Напоминание* — ваша запись в *{time}* (через ~15 мин).\nДо встречи! ✂️",

    "service.haircut_adult": "Стрижка (Взрослая)",
    "service.haircut_child": "Стрижка (Детская)",
    "service.wash": "Мытьё волос",
    "service.beard": "Стрижка бороды",
  },

  EN: {
    "bot.welcome":
      "Welcome to the barbershop! 💈\n\nTo book an appointment we just need your phone number — tap the button below to share it.",
    "bot.share_phone_btn": "📱 Share my phone number",
    "bot.contact_thanks": "Thanks! You're all set. ✂️",
    "bot.contact_wrong": "Please share *your own* contact using the button below.",
    "bot.menu_prompt": "Tap the button below to continue 👇",
    "bot.open_dashboard": "Open dashboard",
    "bot.book_haircut": "Book a haircut",
    "bot.help":
      "Tap the menu button to open the booking app.\n\nCommands:\n/start — register / re-open menu\n/language — change language\n/help — this message",
    "bot.language_prompt": "Choose your language:",
    "bot.language_set": "Language set ✅",
    "bot.share_location_btn": "📍 Send shop location",
    "bot.location_prompt":
      "Send your shop's location — customers will see it on a map in the booking confirmation message.\n\nTap the button below 👇",
    "bot.location_admin_only": "Only the barber can set the shop location.",
    "bot.location_saved":
      "✅ Location saved.\n\nCoords: `{lat}, {lng}`\nCustomers will see them on a map in the booking confirmation.",

    "notify.reminder_will": "We'll remind you 15 minutes before your slot.",
    "notify.reminders_off": "Reminders are off for this booking.",
    "notify.confirmed":
      "✅ *Booking confirmed*\n\nBarber: {barber}\nTime: *{time}*\nDuration: {dur} min\nTotal: {total}{location}\n\n{rem}",
    "notify.location_line": "\n📍 *Location:* {location}",
    "notify.shifted_earlier":
      "🎉 *Good news!* A slot opened earlier — your appointment moved from {old} to *{new}*. You can come in earlier.",
    "notify.shifted_later":
      "🙏 *Schedule update* — your appointment moved from {old} to *{new}*. Sorry for the change!",
    "notify.transferred":
      "ℹ️ Your appointment at {time} was moved from *{oldBarber}* to *{newBarber}*.",
    "notify.reminder":
      "⏰ *Reminder* — your appointment is at *{time}* (in ~15 min).\nSee you soon! ✂️",

    "service.haircut_adult": "Haircut (Adult)",
    "service.haircut_child": "Haircut (Child)",
    "service.wash": "Hair wash",
    "service.beard": "Beard cut",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type TranslationKey = keyof (typeof STRINGS)[typeof DEFAULT_LANG];

function pickLang(lang: Lang | string | null | undefined): Lang {
  const v = (lang ?? "").toString().toUpperCase();
  return v === "UZ" || v === "RU" || v === "EN" ? (v as Lang) : DEFAULT_LANG;
}

export function t(
  lang: Lang | string | null | undefined,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const langKey = pickLang(lang);
  const template = STRINGS[langKey][key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function languageButtons() {
  return [
    [{ text: "🇺🇿 O'zbekcha", callback_data: "lang:UZ" }],
    [{ text: "🇷🇺 Русский", callback_data: "lang:RU" }],
    [{ text: "🇬🇧 English", callback_data: "lang:EN" }],
  ];
}
