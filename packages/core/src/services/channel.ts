import { and, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { env } from "../env";
import { getDb } from "../db/client";
import { campaigns, channelPosts, dreamMedia, dreams } from "../db/schema";
import { AppError } from "../errors";
import { escapeHtml } from "../i18n";
import { getObjectBuffer } from "../storage";
import { botApi, InlineKeyboard, InputFile, miniAppLink } from "../telegram/bot-api";
import { truncate } from "../utils";

/**
 * Telegram channel publishing. Posts are prepared in the admin panel and need
 * an explicit admin approval. User dreams can only be used when the owner has
 * given publication consent; the original text and audio are never posted.
 */

export async function suggestCaption(dreamId: string): Promise<string> {
  const [d] = await getDb().select().from(dreams).where(eq(dreams.id, dreamId));
  if (!d) throw new AppError("not_found", "Dream not found");
  const title = d.title ?? "Сон";
  const mood = d.atmosphere ? `\n<i>${escapeHtml(d.atmosphere)}</i>` : "";
  return `🌙 <b>${escapeHtml(title)}</b>${mood}\n\n${escapeHtml(truncate(d.summary ?? "", 300))}\n\nРасскажи свой сон — и увидь его.`;
}

export async function eligibleDreamsForChannel(limit = 50) {
  return getDb()
    .select({ dream: dreams, media: dreamMedia })
    .from(dreams)
    .innerJoin(dreamMedia, and(eq(dreamMedia.dreamId, dreams.id), eq(dreamMedia.status, "ready"), inArray(dreamMedia.mediaType, ["slideshow", "video"]), isNull(dreamMedia.deletedAt)))
    .where(and(isNotNull(dreams.publicationConsentAt), isNull(dreams.deletedAt)))
    .orderBy(desc(dreams.publicationConsentAt), desc(dreamMedia.createdAt))
    .limit(limit);
}

/** Cancels drafts/scheduled posts of a dream (consent withdrawn or dream deleted). */
export async function cancelPostsForDream(dreamId: string, reason: string): Promise<number> {
  const rows = await getDb()
    .update(channelPosts)
    .set({ status: "cancelled", error: reason })
    .where(and(eq(channelPosts.dreamId, dreamId), inArray(channelPosts.status, ["draft", "scheduled"])))
    .returning({ id: channelPosts.id });
  return rows.length;
}

export async function createChannelPost(input: { dreamId?: string | null; mediaId?: string | null; caption: string; buttonText?: string | null; campaignCode?: string | null; scheduledAt?: Date | null; adminTelegramId: number }) {
  const db = getDb();
  let mediaRef: { kind: "video" | "photo"; mediaId: string } | null = null;
  if (input.mediaId) {
    const [m] = await db.select().from(dreamMedia).where(eq(dreamMedia.id, input.mediaId));
    if (!m || m.status !== "ready") throw new AppError("not_found", "Media not found");
    const [d] = await db.select().from(dreams).where(eq(dreams.id, m.dreamId));
    if (!d?.publicationConsentAt) throw new AppError("forbidden", "The owner has not consented to publication");
    mediaRef = { kind: m.mediaType === "image" ? "photo" : "video", mediaId: m.id };
  }
  let campaignId: string | null = null;
  if (input.campaignCode) {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.code, input.campaignCode.toLowerCase()));
    campaignId = c?.id ?? null;
  }
  const [post] = await db
    .insert(channelPosts)
    .values({
      dreamId: input.dreamId ?? null,
      mediaId: input.mediaId ?? null,
      media: mediaRef,
      caption: input.caption.slice(0, 1024),
      buttonText: input.buttonText ?? "Увидеть свой сон 🌙",
      campaignId,
      status: "draft",
      scheduledAt: input.scheduledAt ?? null,
      createdBy: input.adminTelegramId,
    })
    .returning();
  return post!;
}

export async function approveChannelPost(postId: string, adminTelegramId: number, when: Date | null) {
  const [post] = await getDb()
    .update(channelPosts)
    .set({ status: "scheduled", scheduledAt: when ?? new Date(), approvedBy: adminTelegramId, error: null })
    // A failed post can be approved again (retry) — the new scheduledAt gives it a fresh publish job id.
    .where(and(eq(channelPosts.id, postId), inArray(channelPosts.status, ["draft", "failed"])))
    .returning();
  if (!post) throw new AppError("conflict", "Only drafts or failed posts can be scheduled");
  return post;
}

export async function cancelChannelPost(postId: string) {
  const res = await getDb()
    .update(channelPosts)
    .set({ status: "cancelled" })
    .where(and(eq(channelPosts.id, postId), inArray(channelPosts.status, ["draft", "scheduled", "failed"])))
    .returning({ id: channelPosts.id });
  if (res.length === 0) throw new AppError("conflict", "Only drafts, scheduled or failed posts can be cancelled");
}

export async function duePosts() {
  return getDb()
    .select()
    .from(channelPosts)
    .where(and(eq(channelPosts.status, "scheduled"), lte(channelPosts.scheduledAt, new Date())))
    .limit(10);
}

/** Publishes an approved post. Called by the worker scheduler. */
export async function publishChannelPost(postId: string): Promise<void> {
  const channel = env().TELEGRAM_CHANNEL_ID;
  if (!channel) throw new AppError("validation_failed", "TELEGRAM_CHANNEL_ID is not configured");
  const db = getDb();
  const [post] = await db
    .update(channelPosts)
    .set({ status: "publishing" })
    .where(and(eq(channelPosts.id, postId), eq(channelPosts.status, "scheduled")))
    .returning();
  if (!post) return;
  try {
    let campaignCode = "channel";
    if (post.campaignId) {
      const [c] = await db.select().from(campaigns).where(eq(campaigns.id, post.campaignId));
      if (c) campaignCode = c.code;
    }
    // Consent is re-checked at publish time: withdrawn consent or a deleted dream stops the post.
    if (post.dreamId || post.media) {
      const dreamId = post.dreamId ?? (post.media ? (await db.select({ d: dreamMedia.dreamId }).from(dreamMedia).where(eq(dreamMedia.id, post.media.mediaId)))[0]?.d : undefined);
      const [d] = dreamId ? await db.select({ consent: dreams.publicationConsentAt, deletedAt: dreams.deletedAt }).from(dreams).where(eq(dreams.id, dreamId)) : [];
      if (!d || d.deletedAt || !d.consent) {
        await db.update(channelPosts).set({ status: "cancelled", error: "consent_withdrawn_or_dream_deleted" }).where(eq(channelPosts.id, post.id));
        return;
      }
    }
    const kb = new InlineKeyboard().url(post.buttonText ?? "Open", miniAppLink(`c_${campaignCode}`));
    let messageId: number;
    if (post.media) {
      const [m] = await db.select().from(dreamMedia).where(eq(dreamMedia.id, post.media.mediaId));
      if (!m?.storageKey || m.status !== "ready" || m.deletedAt) throw new Error("media missing");
      const file = m.telegramFileId ?? new InputFile(await getObjectBuffer(m.storageKey), `dream.${m.format}`);
      const sent =
        post.media.kind === "photo"
          ? await botApi().sendPhoto(channel, file, { caption: post.caption, parse_mode: "HTML", reply_markup: kb })
          : await botApi().sendVideo(channel, file, { caption: post.caption, parse_mode: "HTML", reply_markup: kb, supports_streaming: true });
      messageId = sent.message_id;
    } else {
      const sent = await botApi().sendMessage(channel, post.caption, { parse_mode: "HTML", reply_markup: kb });
      messageId = sent.message_id;
    }
    await db.update(channelPosts).set({ status: "published", publishedAt: new Date(), telegramMessageId: messageId, error: null }).where(eq(channelPosts.id, post.id));
  } catch (err) {
    await db.update(channelPosts).set({ status: "failed", error: (err as Error).message.slice(0, 500) }).where(eq(channelPosts.id, post.id));
    throw err;
  }
}
