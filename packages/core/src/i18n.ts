/**
 * Server-side localized messages (bot replies, notifications, user-facing error
 * texts). UI strings of the Mini App live in apps/web/src/i18n.
 * All bot messages use parse_mode=HTML — interpolated values must be escaped.
 */

export type Locale = "ru" | "en";
export const LOCALES: Locale[] = ["ru", "en"];

export function resolveLocale(languageCode?: string | null): Locale {
  if (!languageCode) return "ru";
  const lc = languageCode.toLowerCase();
  if (lc.startsWith("en")) return "en";
  if (["ru", "uk", "be", "kk", "uz", "ky", "tg", "hy", "az", "ka"].some((p) => lc.startsWith(p))) return "ru";
  return "en";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ru = {
  welcome: (appName: string) =>
    `Добро пожаловать в ${escapeHtml(appName)} 🌙\n\nТеперь твои сны можно не только помнить, но и увидеть.\n\nРасскажи свой сон голосом, а искусственный интеллект превратит его в визуальную историю.`,
  btnRecord: "🎙 Записать сон",
  btnMyDreams: "🌌 Мои сны",
  btnOpenApp: "Открыть DREAM AI",
  btnWatch: "▶️ Посмотреть результат",
  btnReview: "✍️ Проверить текст",
  btnBuy: "⭐ Купить генерации",
  btnProfile: "Профиль",
  dreamPrompt: "Расскажи сон голосовым сообщением прямо сюда 🎙\nИли нажми кнопку, чтобы записать его в приложении.",
  help:
    "<b>Как это работает</b>\n\n1. Запиши сон голосом — в приложении или голосовым сообщением сюда.\n2. Проверь текст, который мы услышали.\n3. Выбери формат: слайд-шоу или AI-видео.\n4. Получи визуальную историю — она сохранится в «Мои сны».\n\n<b>Команды</b>\n/dream — записать новый сон\n/library — мои сны\n/balance — баланс генераций\n/settings — настройки\n/paysupport — помощь с оплатой\n/support — написать в поддержку",
  balance: (balance: number, reserved: number, freeLeft: number) =>
    `<b>Баланс:</b> ${balance} кр.${reserved > 0 ? `\n<b>В обработке:</b> ${reserved} кр.` : ""}${freeLeft > 0 ? `\n<b>Бесплатных слайд-шоу:</b> ${freeLeft}` : ""}`,
  settings: "Настройки языка, уведомлений и конфиденциальности находятся в профиле приложения.",
  paysupport:
    "<b>Помощь с оплатой</b>\n\nОпиши проблему одним сообщением ответом на это (номер платежа, дата, что пошло не так). Мы ответим здесь же.\n\nЕсли генерация не удалась, кредиты возвращаются на баланс автоматически.",
  supportPrompt: "Напиши свой вопрос одним сообщением — мы ответим здесь.",
  supportReceived: (id: string) => `Спасибо! Обращение №${escapeHtml(id.slice(0, 8))} принято. Мы ответим в этом чате.`,
  supportReply: (text: string) => `<b>Ответ поддержки:</b>\n\n${escapeHtml(text)}`,
  voiceReceived: "Слушаю твой сон… 🌙",
  textReceived: "Записал. Открой, чтобы проверить текст и выбрать формат.",
  voiceTooLong: (maxMin: number) => `Запись слишком длинная. Максимум — ${maxMin} мин.`,
  voiceTooLarge: "Файл слишком большой. Попробуй записать короче.",
  textTooShort: "Расскажи чуть подробнее — хотя бы пару предложений.",
  transcriptReady: (snippet: string) => `<b>Вот что мы услышали:</b>\n\n<i>${escapeHtml(snippet)}</i>\n\nПроверь текст и выбери формат визуализации.`,
  transcriptionFailed: "Не получилось распознать запись. Попробуй ещё раз или напиши сон текстом.",
  analysisReady: (title: string) => `🌙 <b>${escapeHtml(title)}</b>\n\nСюжет разобран на сцены. Выбери, как оживить сон: слайд-шоу или AI-видео.`,
  btnChooseFormat: "✨ Выбрать формат",
  generationReady: (title: string, isVideo: boolean) =>
    `Твой сон готов 🌙\n\nМы превратили историю «${escapeHtml(title)}» в ${isVideo ? "фильм" : "слайд-шоу"}.`,
  generationFailed: (title: string, reason: string, refunded: boolean) =>
    `Не удалось создать визуализацию «${escapeHtml(title)}».\n${escapeHtml(reason)}${refunded ? "\n\nКредиты возвращены на баланс." : ""}`,
  paymentSuccess: (credits: number, balance: number) => `Оплата прошла ✨\nНачислено: ${credits} кр. Баланс: ${balance} кр.`,
  paymentStartedGeneration: "Генерация запущена — пришлём уведомление, когда всё будет готово.",
  reminder: "Доброе утро 🌙 Помнишь, что тебе снилось? Запиши, пока не забыл.",
  adminLogin: (url: string) => `Ссылка для входа в админ-панель (действует 10 минут, одноразовая):\n${escapeHtml(url)}`,
  notAdmin: "Команда недоступна.",
  accountDeleted: "Твой аккаунт и все сны удалены. Если захочешь вернуться — просто нажми /start.",
  refundDone: (stars: number) => `Возврат ${stars} ⭐ выполнен.`,
  unknown: "Отправь голосовое сообщение с рассказом о сне или открой приложение.",
  restricted: "Доступ к аккаунту ограничен. Напиши в /support, если это ошибка.",
  untitled: "Сон без названия",
  terms:
    "<b>Условия</b>\n\nОплата Telegram Stars используется для покупки цифровых генераций внутри DREAM AI. Неиспользованные кредиты остаются на балансе. Если генерация не удалась по нашей вине, кредиты возвращаются автоматически. Вопросы по оплате — /paysupport.",
};

type Messages = typeof ru;

const en: Messages = {
  welcome: (appName) =>
    `Welcome to ${escapeHtml(appName)} 🌙\n\nNow you can not only remember your dreams — you can see them.\n\nTell your dream with your voice, and AI will turn it into a visual story.`,
  btnRecord: "🎙 Record a dream",
  btnMyDreams: "🌌 My dreams",
  btnOpenApp: "Open DREAM AI",
  btnWatch: "▶️ Watch the result",
  btnReview: "✍️ Review the text",
  btnBuy: "⭐ Buy generations",
  btnProfile: "Profile",
  dreamPrompt: "Tell me your dream in a voice message right here 🎙\nOr tap the button to record it in the app.",
  help:
    "<b>How it works</b>\n\n1. Record your dream — in the app or as a voice message here.\n2. Check the text we heard.\n3. Pick a format: slideshow or AI video.\n4. Get your visual story — it's saved in “My dreams”.\n\n<b>Commands</b>\n/dream — record a new dream\n/library — my dreams\n/balance — credits balance\n/settings — settings\n/paysupport — payment help\n/support — contact support",
  balance: (balance, reserved, freeLeft) =>
    `<b>Balance:</b> ${balance} cr.${reserved > 0 ? `\n<b>In progress:</b> ${reserved} cr.` : ""}${freeLeft > 0 ? `\n<b>Free slideshows:</b> ${freeLeft}` : ""}`,
  settings: "Language, notification and privacy settings are in the app profile.",
  paysupport:
    "<b>Payment help</b>\n\nDescribe the problem in one message as a reply (payment id, date, what went wrong). We will answer right here.\n\nIf a generation fails, credits are returned to your balance automatically.",
  supportPrompt: "Write your question in one message — we'll answer here.",
  supportReceived: (id) => `Thanks! Request #${escapeHtml(id.slice(0, 8))} received. We'll reply in this chat.`,
  supportReply: (text) => `<b>Support reply:</b>\n\n${escapeHtml(text)}`,
  voiceReceived: "Listening to your dream… 🌙",
  textReceived: "Saved. Open it to check the text and choose a format.",
  voiceTooLong: (maxMin) => `The recording is too long. Maximum is ${maxMin} min.`,
  voiceTooLarge: "The file is too large. Try a shorter recording.",
  textTooShort: "Tell a bit more — at least a couple of sentences.",
  transcriptReady: (snippet) => `<b>Here's what we heard:</b>\n\n<i>${escapeHtml(snippet)}</i>\n\nCheck the text and choose a visualization format.`,
  transcriptionFailed: "We couldn't recognise the recording. Try again or type your dream.",
  analysisReady: (title) => `🌙 <b>${escapeHtml(title)}</b>\n\nThe story is split into scenes. Choose how to bring it to life: a slideshow or an AI video.`,
  btnChooseFormat: "✨ Choose a format",
  generationReady: (title, isVideo) => `Your dream is ready 🌙\n\nWe turned “${escapeHtml(title)}” into a ${isVideo ? "film" : "slideshow"}.`,
  generationFailed: (title, reason, refunded) =>
    `We couldn't create “${escapeHtml(title)}”.\n${escapeHtml(reason)}${refunded ? "\n\nYour credits have been returned." : ""}`,
  paymentSuccess: (credits, balance) => `Payment received ✨\nAdded: ${credits} cr. Balance: ${balance} cr.`,
  paymentStartedGeneration: "Generation started — we'll notify you when it's ready.",
  reminder: "Good morning 🌙 Remember what you dreamed? Record it before it fades.",
  adminLogin: (url) => `Admin panel sign-in link (valid for 10 minutes, single use):\n${escapeHtml(url)}`,
  notAdmin: "Command unavailable.",
  accountDeleted: "Your account and all dreams have been deleted. Tap /start if you want to come back.",
  refundDone: (stars) => `Refund of ${stars} ⭐ completed.`,
  unknown: "Send a voice message describing your dream or open the app.",
  restricted: "Account access is restricted. Contact /support if this is a mistake.",
  untitled: "Untitled dream",
  terms:
    "<b>Terms</b>\n\nTelegram Stars are used to purchase digital generations inside DREAM AI. Unused credits stay on your balance. If a generation fails on our side, credits are returned automatically. Payment questions — /paysupport.",
};

const dictionaries: Record<Locale, Messages> = { ru, en };

export function msg(locale: Locale): Messages {
  return dictionaries[locale] ?? ru;
}

/** User-facing explanation for an error code (used in notifications). */
export function errorText(code: string | null | undefined, locale: Locale): string {
  const table: Record<Locale, Record<string, string>> = {
    ru: {
      provider_rejected_content: "Сервис генерации отклонил часть сюжета. Попробуй смягчить описание или выбрать другой стиль.",
      provider_unavailable: "Сервис генерации временно недоступен. Попробуй чуть позже.",
      provider_timeout: "Генерация заняла слишком много времени.",
      spend_limit_reached: "Сервис сейчас перегружен. Попробуй позже.",
      analysis_failed: "Не удалось разобрать сюжет сна.",
      transcription_failed: "Не удалось распознать запись.",
      default: "Что-то пошло не так на нашей стороне.",
    },
    en: {
      provider_rejected_content: "The generation service rejected part of the story. Try softening the description or another style.",
      provider_unavailable: "The generation service is temporarily unavailable. Please try later.",
      provider_timeout: "Generation took too long.",
      spend_limit_reached: "The service is busy right now. Please try later.",
      analysis_failed: "We couldn't understand the dream's story.",
      transcription_failed: "We couldn't recognise the recording.",
      default: "Something went wrong on our side.",
    },
  };
  const t = table[locale] ?? table.ru;
  return (code && t[code]) || t.default!;
}
