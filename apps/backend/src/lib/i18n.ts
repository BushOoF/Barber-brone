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

    "voice.unavailable": "🎙 Ovozli yordamchi hozircha ishlamayapti. Birozdan so'ng urinib ko'ring.",
    "voice.failed": "🎙 Ovozli xabarni qayta ishlab bo'lmadi. Yana bir bor yuboring.",
    "voice.not_understood":
      "🤔 Tushunolmadim.\nEshitganim: \"{heard}\"\nMasalan: \"ertaga soat uchda yozing\" yoki sartarosh uchun: \"birdan ikkigacha tanaffus\".",
    "voice.heard": "\n\n_Eshitildi:_ \"{heard}\"",
    "voice.confirm_title": "Tasdiqlaysizmi?",
    "voice.btn_confirm": "✅ Tasdiqlash",
    "voice.btn_cancel": "❌ Bekor qilish",
    "voice.cancelled": "❌ Bekor qilindi.",
    "voice.now": "hozir",
    "voice.today": "bugun",
    "voice.tomorrow": "ertaga",
    "voice.sum_book_asap": "✂️ Eng yaqin bo'sh vaqtga yozilish",
    "voice.sum_book_time": "✂️ Yozilish — {date}, soat {time}",
    "voice.sum_break": "☕️ Tanaffus — {start}–{end}",
    "voice.sum_walkin": "🚶 Navbatsiz mijoz — {start}, {dur} daqiqa",
    "voice.booked": "✅ Soat *{time}* ga yozildingiz!",
    "voice.break_done": "✅ Tanaffus qo'shildi: {start}–{end}.",
    "voice.walkin_done": "✅ Navbatsiz mijoz qo'shildi: {start}.",
    "voice.no_slot": "😔 Yaqin kunlarda bo'sh vaqt topilmadi.",
    "voice.slot_taken": "😔 Bu vaqt band. Boshqa vaqtni ayting.",
    "voice.need_phone": "Avval /start bosib, telefon raqamingizni yuboring.",
    "voice.no_barber": "Sartarosh topilmadi.",
    "voice.sum_cancel_book": "🗑 Yozuvni bekor qilish",
    "voice.sum_cancel_break": "🗑 Tanaffusni bekor qilish",
    "voice.sum_announce": "📢 E'lon: \"{msg}\"",
    "voice.sum_service": "💲 {service}: {changes}",
    "voice.sum_hours": "🕐 Ish vaqti: {hours}",
    "voice.sum_vacation": "🌴 Dam olish kuni: {date}",
    "voice.booking_cancelled": "✅ Yozuv bekor qilindi ({time}).",
    "voice.break_cancelled": "✅ Tanaffus bekor qilindi ({start}–{end}).",
    "voice.announced": "✅ E'lon {delivered}/{recipients} mijozga yuborildi.",
    "voice.service_updated": "✅ {name} yangilandi.",
    "voice.hours_updated": "✅ Ish vaqti yangilandi.",
    "voice.vacation_added": "✅ Dam olish kuni qo'shildi: {date}.",
    "voice.nothing": "Bekor qiladigan narsa topilmadi.",
    "voice.ambiguous": "Bir nechtasi mos keldi — vaqtini aniqroq ayting.",
    "voice.service_not_found": "Bunday xizmat topilmadi.",
    "notify.cancelled_by_shop": "❌ Kechirasiz, {time} dagi yozuvingiz bekor qilindi.",
    "voice.disabled": "🎙 Ovozli yordamchi bu sartaroshxonada o'chirilgan.",
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

    "voice.unavailable": "🎙 Голосовой помощник сейчас недоступен. Попробуйте чуть позже.",
    "voice.failed": "🎙 Не удалось обработать голосовое сообщение. Отправьте ещё раз.",
    "voice.not_understood":
      "🤔 Не понял.\nУслышал: \"{heard}\"\nНапример: \"запишите на завтра в три\" или для мастера: \"перерыв с часу до двух\".",
    "voice.heard": "\n\n_Услышано:_ \"{heard}\"",
    "voice.confirm_title": "Подтвердить?",
    "voice.btn_confirm": "✅ Подтвердить",
    "voice.btn_cancel": "❌ Отмена",
    "voice.cancelled": "❌ Отменено.",
    "voice.now": "сейчас",
    "voice.today": "сегодня",
    "voice.tomorrow": "завтра",
    "voice.sum_book_asap": "✂️ Запись на ближайшее свободное время",
    "voice.sum_book_time": "✂️ Запись — {date}, в {time}",
    "voice.sum_break": "☕️ Перерыв — {start}–{end}",
    "voice.sum_walkin": "🚶 Клиент без записи — {start}, {dur} мин",
    "voice.booked": "✅ Вы записаны на *{time}*!",
    "voice.break_done": "✅ Перерыв добавлен: {start}–{end}.",
    "voice.walkin_done": "✅ Клиент без записи добавлен: {start}.",
    "voice.no_slot": "😔 На ближайшие дни нет свободного времени.",
    "voice.slot_taken": "😔 Это время занято. Назовите другое.",
    "voice.need_phone": "Сначала нажмите /start и поделитесь номером телефона.",
    "voice.no_barber": "Мастер не найден.",
    "voice.sum_cancel_book": "🗑 Отменить запись",
    "voice.sum_cancel_break": "🗑 Отменить перерыв",
    "voice.sum_announce": "📢 Объявление: \"{msg}\"",
    "voice.sum_service": "💲 {service}: {changes}",
    "voice.sum_hours": "🕐 Часы работы: {hours}",
    "voice.sum_vacation": "🌴 Выходной: {date}",
    "voice.booking_cancelled": "✅ Запись отменена ({time}).",
    "voice.break_cancelled": "✅ Перерыв отменён ({start}–{end}).",
    "voice.announced": "✅ Объявление отправлено {delivered}/{recipients} клиентам.",
    "voice.service_updated": "✅ {name} обновлено.",
    "voice.hours_updated": "✅ Часы работы обновлены.",
    "voice.vacation_added": "✅ Добавлен выходной: {date}.",
    "voice.nothing": "Нечего отменять.",
    "voice.ambiguous": "Подходит несколько — уточните время.",
    "voice.service_not_found": "Такая услуга не найдена.",
    "notify.cancelled_by_shop": "❌ Извините, ваша запись на {time} отменена.",
    "voice.disabled": "🎙 Голосовой помощник отключён в этой парикмахерской.",
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

    "voice.unavailable": "🎙 The voice assistant is unavailable right now. Please try again shortly.",
    "voice.failed": "🎙 Couldn't process that voice message. Please send it again.",
    "voice.not_understood":
      "🤔 I didn't catch that.\nHeard: \"{heard}\"\nE.g. \"book me tomorrow at three\" or, for the barber: \"break from one to two\".",
    "voice.heard": "\n\n_Heard:_ \"{heard}\"",
    "voice.confirm_title": "Confirm?",
    "voice.btn_confirm": "✅ Confirm",
    "voice.btn_cancel": "❌ Cancel",
    "voice.cancelled": "❌ Cancelled.",
    "voice.now": "now",
    "voice.today": "today",
    "voice.tomorrow": "tomorrow",
    "voice.sum_book_asap": "✂️ Book the next available slot",
    "voice.sum_book_time": "✂️ Booking — {date}, at {time}",
    "voice.sum_break": "☕️ Break — {start}–{end}",
    "voice.sum_walkin": "🚶 Walk-in — {start}, {dur} min",
    "voice.booked": "✅ You're booked for *{time}*!",
    "voice.break_done": "✅ Break added: {start}–{end}.",
    "voice.walkin_done": "✅ Walk-in added: {start}.",
    "voice.no_slot": "😔 No free slots in the next few days.",
    "voice.slot_taken": "😔 That time is taken. Tell me another.",
    "voice.need_phone": "First tap /start and share your phone number.",
    "voice.no_barber": "No barber found.",
    "voice.sum_cancel_book": "🗑 Cancel a booking",
    "voice.sum_cancel_break": "🗑 Cancel a break",
    "voice.sum_announce": "📢 Announce: \"{msg}\"",
    "voice.sum_service": "💲 {service}: {changes}",
    "voice.sum_hours": "🕐 Working hours: {hours}",
    "voice.sum_vacation": "🌴 Day off: {date}",
    "voice.booking_cancelled": "✅ Booking cancelled ({time}).",
    "voice.break_cancelled": "✅ Break cancelled ({start}–{end}).",
    "voice.announced": "✅ Announcement sent to {delivered}/{recipients} customers.",
    "voice.service_updated": "✅ {name} updated.",
    "voice.hours_updated": "✅ Working hours updated.",
    "voice.vacation_added": "✅ Day off added: {date}.",
    "voice.nothing": "Nothing to cancel.",
    "voice.ambiguous": "Several match — please say the time.",
    "voice.service_not_found": "No such service found.",
    "notify.cancelled_by_shop": "❌ Sorry, your appointment at {time} was cancelled.",
    "voice.disabled": "🎙 The voice assistant is turned off for this shop.",
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
