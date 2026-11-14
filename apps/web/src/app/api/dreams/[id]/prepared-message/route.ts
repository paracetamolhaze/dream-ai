import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@dream/core/errors";
import { mediaDto } from "@dream/core/services/media";
import { track } from "@dream/core/services/analytics";
import { providerAccessibleUrl, signMediaUrl } from "@dream/core/storage";
import { botApi, hasBotToken, InlineKeyboard, miniAppLink } from "@dream/core/telegram/bot-api";
import { msg } from "@dream/core/i18n";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";
import { loadOwnedMedia } from "@/server/telegram-media";

export const dynamic = "force-dynamic";

/**
 * Prepares an inline message (Bot API savePreparedInlineMessage) so the Mini
 * App can call Telegram.WebApp.shareMessage(id) — the native "send to chat"
 * picker. Uses the cached Telegram file_id when available, otherwise a
 * short-lived signed public URL (requires a public HTTPS deployment).
 */
export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 20 });
  if (!hasBotToken()) throw new AppError("provider_unavailable", "Bot is not configured");
  const dreamId = UuidParam.parse(params.id);
  const { mediaId, showTitle } = await readJson(req, z.object({ mediaId: z.string().uuid(), showTitle: z.boolean().default(true) }));
  const { media, title } = await loadOwnedMedia(user, dreamId, mediaId);
  if (media.mediaType !== "slideshow" && media.mediaType !== "video") throw new AppError("validation_failed", "Only finished results can be shared");
  const m = msg(userLocale(user));
  // The owner decides whether the dream title travels with the shared video.
  const shownTitle = showTitle ? (title ?? m.untitled) : m.untitled;
  const caption = `🌙 ${shownTitle}`;
  const kb = new InlineKeyboard().url(m.btnRecord, miniAppLink(`ref_${user.referralCode}`));
  const id = randomUUID().replace(/-/g, "").slice(0, 32);
  let result;
  if (media.telegramFileId) {
    result = { type: "video" as const, id, video_file_id: media.telegramFileId, title: shownTitle, caption, reply_markup: kb };
  } else {
    const url = providerAccessibleUrl(media.id);
    if (!url) throw new AppError("media_unavailable", "Sharing needs a public HTTPS deployment");
    const thumb = mediaDto(media).thumbUrl ? signMediaUrl(media.id, { variant: "thumb", absolute: true, ttlSec: 3 * 3600 }) : url;
    result = { type: "video" as const, id, video_url: url, mime_type: "video/mp4" as const, thumbnail_url: thumb, title: shownTitle, caption, reply_markup: kb };
  }
  const prepared = await botApi().savePreparedInlineMessage(user.telegramId, result, { allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true });
  await track("result_shared", user.id, { via: "telegram" });
  return json({ id: prepared.id });
});
