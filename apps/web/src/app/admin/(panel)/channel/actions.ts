"use server";

import { z } from "zod";
import { env } from "@dream/core/env";
import { AppError } from "@dream/core/errors";
import { ensureCampaign, resetChannelPostToDraft, updateChannelPostDraft } from "@dream/core/services/admin-ops";
import { approveChannelPost, cancelChannelPost, createChannelPost, publishChannelPost, suggestCaption } from "@dream/core/services/channel";
import { adminAction, zOptDateTime, zOptText, zUuid } from "@/server/admin/action";

export const createPostAction = adminAction({
  name: "channel.post.create",
  revalidate: ["/admin/channel"],
  schema: z.object({
    source: z.string().min(1),
    caption: z.string().trim().max(1024).optional(),
    buttonText: zOptText(64),
    campaignCode: z.string().trim().max(40).optional(),
    scheduledAt: zOptDateTime,
  }),
  async run(input, admin) {
    let dreamId: string | null = null;
    let mediaId: string | null = null;
    if (input.source !== "text") {
      const [d, m] = input.source.split(":");
      dreamId = z.string().uuid().parse(d);
      mediaId = z.string().uuid().parse(m);
    }
    let caption = input.caption ?? "";
    if (!caption) {
      if (!dreamId) throw new AppError("validation_failed", "Caption is required for a text-only post");
      caption = await suggestCaption(dreamId);
    }
    const campaignCode = input.campaignCode || (await ensureCampaign("channel", "Telegram-канал", "channel")).code;
    const post = await createChannelPost({ dreamId, mediaId, caption, buttonText: input.buttonText, campaignCode, scheduledAt: input.scheduledAt, adminTelegramId: admin.telegramId });
    return { message: "Черновик создан — проверьте превью и подтвердите публикацию", target: { type: "channel_post", id: post.id }, payload: { dreamId, mediaId, campaignCode } };
  },
});

export const updatePostAction = adminAction({
  name: "channel.post.update",
  revalidate: ["/admin/channel"],
  schema: z.object({ postId: zUuid, caption: z.string().trim().min(1).max(1024), buttonText: zOptText(64) }),
  async run(input) {
    await updateChannelPostDraft(input.postId, { caption: input.caption, buttonText: input.buttonText });
    return { message: "Черновик обновлён", target: { type: "channel_post", id: input.postId } };
  },
});

export const regenerateCaptionAction = adminAction({
  name: "channel.post.caption.suggest",
  revalidate: ["/admin/channel"],
  schema: z.object({ postId: zUuid, dreamId: zUuid }),
  async run(input) {
    const caption = await suggestCaption(input.dreamId);
    await updateChannelPostDraft(input.postId, { caption, buttonText: null });
    return { message: "Подпись сгенерирована заново", target: { type: "channel_post", id: input.postId } };
  },
});

export const approvePostAction = adminAction({
  name: "channel.post.approve",
  revalidate: ["/admin/channel"],
  schema: z.object({ postId: zUuid, scheduledAt: zOptDateTime, mode: z.enum(["now", "schedule"]).default("schedule") }),
  async run(input, admin) {
    if (input.mode === "now") {
      if (!env().TELEGRAM_CHANNEL_ID) throw new AppError("validation_failed", "TELEGRAM_CHANNEL_ID is not configured");
      await approveChannelPost(input.postId, admin.telegramId, new Date());
      await publishChannelPost(input.postId);
      return { message: "Пост опубликован в канале", target: { type: "channel_post", id: input.postId }, payload: { mode: "now" } };
    }
    const when = input.scheduledAt ?? new Date();
    await approveChannelPost(input.postId, admin.telegramId, when);
    return { message: `Публикация запланирована — воркер отправит пост в ${when.toISOString().slice(11, 16)} UTC или сразу, если время прошло`, target: { type: "channel_post", id: input.postId }, payload: { scheduledAt: when.toISOString() } };
  },
});

export const cancelPostAction = adminAction({
  name: "channel.post.cancel",
  revalidate: ["/admin/channel"],
  schema: z.object({ postId: zUuid }),
  async run(input) {
    await cancelChannelPost(input.postId);
    return { message: "Публикация отменена", target: { type: "channel_post", id: input.postId } };
  },
});

export const resetPostAction = adminAction({
  name: "channel.post.reset",
  revalidate: ["/admin/channel"],
  schema: z.object({ postId: zUuid }),
  async run(input) {
    await resetChannelPostToDraft(input.postId);
    return { message: "Пост возвращён в черновики", target: { type: "channel_post", id: input.postId } };
  },
});
