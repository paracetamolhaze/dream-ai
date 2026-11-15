import { eq } from "drizzle-orm";
import { GrammyError } from "grammy";
import { getDb } from "../db/client";
import { dreamMedia, dreams, generationJobs, users } from "../db/schema";
import { errorText, msg } from "../i18n";
import { logger } from "../logger";
import { getObjectBuffer } from "../storage";
import { botApi, hasBotToken, InlineKeyboard, InputFile, webAppUrl } from "../telegram/bot-api";
import { getUserSettings, userLocale } from "./users";
import { routes } from "../routes";

const MAX_TELEGRAM_UPLOAD = 49 * 1024 * 1024;

function isBlocked(err: unknown): boolean {
  return err instanceof GrammyError && (err.error_code === 403 || /chat not found|bot was blocked/i.test(err.description));
}

async function markChatUnavailable(userId: string) {
  await getDb().update(users).set({ botChatAvailable: false }).where(eq(users.id, userId));
}

/**
 * "Your dream is ready" — sends the video itself (so it can be forwarded and
 * re-shared without new uploads) with a button that opens the dream in the Mini App.
 */
export async function notifyGenerationCompleted(jobId: string): Promise<void> {
  if (!hasBotToken()) return;
  const db = getDb();
  const [row] = await db
    .select({ job: generationJobs, user: users, title: dreams.title })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.userId))
    .innerJoin(dreams, eq(dreams.id, generationJobs.dreamId))
    .where(eq(generationJobs.id, jobId));
  if (!row || row.job.notifiedAt) return;
  const prefs = await getUserSettings(row.user.id);
  if (!prefs.notifications.generationReady) return;
  const locale = userLocale(row.user);
  const m = msg(locale);
  const title = row.title ?? m.untitled;
  const kb = new InlineKeyboard().webApp(m.btnWatch, webAppUrl(routes.dream(row.job.dreamId, row.job.mediaType)));
  const caption = m.generationReady(title, row.job.mediaType === "video");
  try {
    const [media] = row.job.resultMediaId ? await db.select().from(dreamMedia).where(eq(dreamMedia.id, row.job.resultMediaId)) : [];
    let sent = false;
    if (media?.storageKey && (media.sizeBytes ?? 0) > 0 && (media.sizeBytes ?? 0) < MAX_TELEGRAM_UPLOAD) {
      try {
        const buf = await getObjectBuffer(media.storageKey);
        const res = await botApi().sendVideo(row.user.telegramId, new InputFile(buf, `${title}.mp4`), {
          caption,
          parse_mode: "HTML",
          reply_markup: kb,
          supports_streaming: true,
          width: media.width ?? undefined,
          height: media.height ?? undefined,
          duration: media.durationSec ? Math.round(media.durationSec) : undefined,
        });
        const fileId = res.video?.file_id;
        if (fileId) await db.update(dreamMedia).set({ telegramFileId: fileId }).where(eq(dreamMedia.id, media.id));
        sent = true;
      } catch (err) {
        if (isBlocked(err)) throw err;
        logger.warn("sendVideo failed, falling back to text", { error: (err as Error).message });
      }
    }
    if (!sent) await botApi().sendMessage(row.user.telegramId, caption, { parse_mode: "HTML", reply_markup: kb });
    await db.update(generationJobs).set({ notifiedAt: new Date() }).where(eq(generationJobs.id, jobId));
  } catch (err) {
    if (isBlocked(err)) await markChatUnavailable(row.user.id);
    else throw err;
  }
}

export async function notifyGenerationFailed(jobId: string, refunded: boolean): Promise<void> {
  if (!hasBotToken()) return;
  const db = getDb();
  const [row] = await db
    .select({ job: generationJobs, user: users, title: dreams.title })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.userId))
    .innerJoin(dreams, eq(dreams.id, generationJobs.dreamId))
    .where(eq(generationJobs.id, jobId));
  if (!row || row.job.notifiedAt) return;
  const locale = userLocale(row.user);
  const m = msg(locale);
  try {
    await botApi().sendMessage(row.user.telegramId, m.generationFailed(row.title ?? m.untitled, errorText(row.job.errorCode, locale), refunded), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().webApp(m.btnOpenApp, webAppUrl(routes.dream(row.job.dreamId))),
    });
    await db.update(generationJobs).set({ notifiedAt: new Date() }).where(eq(generationJobs.id, jobId));
  } catch (err) {
    if (isBlocked(err)) await markChatUnavailable(row.user.id);
    else logger.warn("failure notification failed", { error: (err as Error).message });
  }
}

/** Generic helper for bot-originated dreams (transcript ready etc.). */
export async function sendToChat(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
  if (!hasBotToken()) return;
  await botApi()
    .sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard })
    .catch((err: Error) => logger.warn("sendToChat failed", { error: err.message }));
}
