import { Api, InlineKeyboard, InputFile } from "grammy";
import { env, publicAppUrl } from "../env";

declare global {
  // eslint-disable-next-line no-var
  var __dreamBotApi: Api | undefined;
}

export function hasBotToken(): boolean {
  return Boolean(env().TELEGRAM_BOT_TOKEN);
}

/** grammY Bot API client usable from any process (web, worker, bot). */
export function botApi(): Api {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  if (!globalThis.__dreamBotApi) globalThis.__dreamBotApi = new Api(token);
  return globalThis.__dreamBotApi;
}

/** URL of a Mini App page (used in inline `web_app` buttons in private chats). */
export function webAppUrl(path = "/"): string {
  return `${publicAppUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * t.me deep link that opens the Mini App with a start parameter. Works in
 * channels and groups where `web_app` buttons are not allowed.
 */
export function miniAppLink(startParam?: string): string {
  const e = env();
  const bot = e.TELEGRAM_BOT_USERNAME ?? "BOT_USERNAME";
  const base = e.TELEGRAM_MINIAPP_SHORT_NAME ? `https://t.me/${bot}/${e.TELEGRAM_MINIAPP_SHORT_NAME}` : `https://t.me/${bot}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : `${base}?startapp`;
}

/** Bot deep link (/start <param>). */
export function botStartLink(param?: string): string {
  const bot = env().TELEGRAM_BOT_USERNAME ?? "BOT_USERNAME";
  return param ? `https://t.me/${bot}?start=${encodeURIComponent(param)}` : `https://t.me/${bot}`;
}

export function webAppKeyboard(text: string, path: string): InlineKeyboard {
  return new InlineKeyboard().webApp(text, webAppUrl(path));
}

export { InlineKeyboard, InputFile };
