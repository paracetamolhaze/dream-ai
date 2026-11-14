/** Russian labels for admin UI enums. */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

type Entry = [label: string, tone: Tone];

export const JOB_STATUS: Record<string, Entry> = {
  queued: ["В очереди", "info"],
  analyzing: ["Анализ", "info"],
  preparing_scenes: ["Подготовка сцен", "info"],
  generating_images: ["Генерация кадров", "accent"],
  generating_video: ["Генерация видео", "accent"],
  rendering: ["Монтаж", "accent"],
  completed: ["Готово", "good"],
  failed: ["Ошибка", "bad"],
  cancelled: ["Отменено", "neutral"],
};

export const PAYMENT_STATUS: Record<string, Entry> = {
  pending: ["Ожидает", "neutral"],
  paid: ["Оплачен", "good"],
  refunded: ["Возврат", "warn"],
  failed: ["Ошибка", "bad"],
  expired: ["Истёк", "neutral"],
};

export const USER_STATUS: Record<string, Entry> = {
  active: ["Активен", "good"],
  restricted: ["Ограничен", "warn"],
  banned: ["Заблокирован", "bad"],
  deleted: ["Удаляется", "neutral"],
};

export const DREAM_STATUS: Record<string, Entry> = {
  draft: ["Черновик", "neutral"],
  transcribing: ["Распознаётся", "info"],
  transcription_failed: ["Ошибка распознавания", "bad"],
  review: ["На проверке", "neutral"],
  analyzing: ["Анализ", "info"],
  analysis_failed: ["Ошибка анализа", "bad"],
  ready: ["Готов", "good"],
};

export const REFERRAL_STATUS: Record<string, Entry> = {
  pending: ["Ожидает", "neutral"],
  qualified: ["Квалифицирован", "info"],
  rewarded: ["Награждён", "good"],
  blocked: ["Заблокирован", "bad"],
};

export const POST_STATUS: Record<string, Entry> = {
  draft: ["Черновик", "neutral"],
  scheduled: ["Запланирован", "info"],
  publishing: ["Публикуется", "accent"],
  published: ["Опубликован", "good"],
  failed: ["Ошибка", "bad"],
  cancelled: ["Отменён", "neutral"],
};

export const TICKET_STATUS: Record<string, Entry> = {
  open: ["Открыт", "warn"],
  answered: ["Отвечен", "good"],
  closed: ["Закрыт", "neutral"],
};

export const CREDIT_TX: Record<string, Entry> = {
  purchase: ["Покупка", "good"],
  reserve: ["Резерв", "info"],
  capture: ["Списание", "neutral"],
  release: ["Возврат резерва", "accent"],
  signup_bonus: ["Бонус за регистрацию", "good"],
  referral_reward: ["Реферальная награда", "good"],
  promo: ["Промокод", "good"],
  admin_grant: ["Начисление админом", "accent"],
  admin_revoke: ["Списание админом", "warn"],
  refund_revoke: ["Списание при возврате", "warn"],
};

export const FORMAT: Record<string, string> = { slideshow: "Слайд-шоу", video: "Видео" };

export const JOB_KIND: Record<string, string> = {
  full: "Полная",
  scene_image: "Кадр сцены",
  scene_video: "Клип сцены",
  rerender: "Перемонтаж",
};

export const CAMPAIGN_TYPE: Record<string, string> = {
  channel: "Канал",
  blogger: "Блогер",
  ads: "Реклама",
  partner: "Партнёр",
  other: "Другое",
};

export const ROLE: Record<string, string> = { owner: "Владелец", admin: "Администратор", support: "Поддержка" };

export const PRODUCT_KIND: Record<string, string> = {
  credit_pack: "Пакет кредитов",
  single_slideshow: "Разовое слайд-шоу",
  single_video_short: "Разовое короткое видео",
  single_video_long: "Разовое длинное видео",
};

export const PRICE_ACTION: Record<string, string> = {
  slideshow: "Слайд-шоу",
  video_short: "AI-видео до 15 с",
  video_medium: "AI-видео до 30 с",
  video_long: "AI-видео длиннее 30 с",
  scene_image: "Перегенерация кадра сцены",
  scene_video: "Перегенерация клипа сцены",
  rerender: "Перемонтаж (без новых генераций)",
};

export const QUEUE_LABEL: Record<string, string> = {
  transcription: "Распознавание",
  analysis: "Анализ сюжета",
  preview: "Превью",
  "generate-slideshow": "Слайд-шоу",
  "generate-video": "Видео",
  system: "Системные",
};

export const SOURCE_LABEL: Record<string, string> = {
  organic: "Органика",
  referral: "Реферальные ссылки",
  campaign: "Кампании / канал",
  other: "Другое",
};

export const DREAM_SOURCE: Record<string, string> = {
  miniapp_voice: "Голос (приложение)",
  miniapp_text: "Текст (приложение)",
  bot_voice: "Голос (бот)",
  bot_text: "Текст (бот)",
};

export function entry(map: Record<string, Entry>, key: string | null | undefined): Entry {
  return (key && map[key]) || [key ?? "—", "neutral"];
}
