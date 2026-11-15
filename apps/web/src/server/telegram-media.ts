import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { GrammyError } from "grammy";
import { getDb } from "@dream/core/db/client";
import { dreamMedia, dreams } from "@dream/core/db/schema";
import { AppError } from "@dream/core/errors";
import { msg } from "@dream/core/i18n";
import { downloadFileName } from "@dream/core/services/media";
import { userLocale, type UserRow } from "@dream/core/services/users";
import { getObjectBuffer } from "@dream/core/storage";
import { botApi, hasBotToken, InlineKeyboard, InputFile, webAppUrl } from "@dream/core/telegram/bot-api";
import { routes } from "@dream/core/routes";

const MAX_UPLOAD = 49 * 1024 * 1024;

export async function loadOwnedMedia(user: UserRow, dreamId: string, mediaId: string) {
  const [row] = await getDb()
    .select({ media: dreamMedia, title: dreams.title })
    .from(dreamMedia)
    .innerJoin(dreams, eq(dreams.id, dreamMedia.dreamId))
    .where(and(eq(dreamMedia.id, mediaId), eq(dreamMedia.dreamId, dreamId), eq(dreamMedia.userId, user.id), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt), isNull(dreams.deletedAt)));
  if (!row?.media.storageKey) throw new AppError("media_unavailable", "Media not available");
  return row;
}

/**
 * Sends a result into the user's private chat with the bot (download/forward
 * fallback inside Telegram). Caches the Telegram file_id for later reuse.
 */
export async function sendMediaToChat(user: UserRow, dreamId: string, mediaId: string): Promise<{ fileId: string | null }> {
  if (!hasBotToken()) throw new AppError("provider_unavailable", "Bot is not configured");
  const { media, title } = await loadOwnedMedia(user, dreamId, mediaId);
  const m = msg(userLocale(user));
  const name = downloadFileName(title, media);
  const kb = new InlineKeyboard().webApp(m.btnOpenApp, webAppUrl(routes.dream(dreamId)));
  try {
    if (media.mediaType === "image") {
      if ((media.sizeBytes ?? 0) > MAX_UPLOAD) throw new AppError("media_unavailable", "File too large for Telegram");
      const buf = await getObjectBuffer(media.storageKey!);
      await botApi().sendDocument(user.telegramId, new InputFile(buf, name), { caption: title ?? undefined, reply_markup: kb });
      return { fileId: null };
    }
    const file = media.telegramFileId ?? new InputFile(await getObjectBuffer(media.storageKey!), name);
    if (!media.telegramFileId && (media.sizeBytes ?? 0) > MAX_UPLOAD) throw new AppError("media_unavailable", "File too large for Telegram");
    const sent = await botApi().sendVideo(user.telegramId, file, {
      caption: title ?? undefined,
      supports_streaming: true,
      reply_markup: kb,
      width: media.width ?? undefined,
      height: media.height ?? undefined,
      duration: media.durationSec ? Math.round(media.durationSec) : undefined,
    });
    const fileId = sent.video?.file_id ?? null;
    if (fileId && fileId !== media.telegramFileId) await getDb().update(dreamMedia).set({ telegramFileId: fileId }).where(eq(dreamMedia.id, media.id));
    return { fileId };
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 403) throw new AppError("forbidden", "Start the bot first to receive files");
    throw err;
  }
}
