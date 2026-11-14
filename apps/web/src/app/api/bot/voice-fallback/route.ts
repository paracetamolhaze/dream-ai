import type { NextRequest } from "next/server";
import { GrammyError } from "grammy";
import { AppError } from "@dream/core/errors";
import { msg } from "@dream/core/i18n";
import { userLocale } from "@dream/core/services/users";
import { botApi, hasBotToken } from "@dream/core/telegram/bot-api";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Fallback when the WebView can't record audio: the bot asks for a voice
 * message in the private chat. Voice messages sent to the bot land in the
 * same dream library as recordings made in the Mini App.
 */
export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 10 });
  if (!hasBotToken()) throw new AppError("provider_unavailable", "Bot is not configured");
  try {
    await botApi().sendMessage(user.telegramId, msg(userLocale(user)).dreamPrompt, { reply_markup: { force_reply: true, input_field_placeholder: "🎙" } });
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 403) throw new AppError("forbidden", "Start the bot first");
    throw err;
  }
  return json({ ok: true });
});
