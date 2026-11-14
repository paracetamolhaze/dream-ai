import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DreamBible, SceneReferenceAsset, JobOptions, StageDetail, NotificationPrefs, ChannelPostMediaRef } from "./types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());

// ─── Enums ──────────────────────────────────────────────────────────────────

export const userStatus = pgEnum("user_status", ["active", "restricted", "banned", "deleted"]);
export const dreamStatus = pgEnum("dream_status", [
  "draft",
  "transcribing",
  "transcription_failed",
  "review",
  "analyzing",
  "analysis_failed",
  "ready",
]);
export const dreamSource = pgEnum("dream_source", ["miniapp_voice", "miniapp_text", "bot_voice", "bot_text"]);
export const mediaType = pgEnum("media_type", ["image", "reference", "video_clip", "slideshow", "video"]);
export const mediaStatus = pgEnum("media_status", ["pending", "processing", "ready", "failed", "deleted"]);
export const outputFormat = pgEnum("output_format", ["slideshow", "video"]);
export const jobKind = pgEnum("job_kind", ["full", "scene_image", "scene_video", "rerender"]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "analyzing",
  "preparing_scenes",
  "generating_images",
  "generating_video",
  "rendering",
  "completed",
  "failed",
  "cancelled",
]);
export const creditState = pgEnum("credit_state", ["none", "reserved", "captured", "released"]);
export const sceneStatus = pgEnum("scene_status", ["pending", "generating", "ready", "failed"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "refunded", "failed", "expired"]);
export const creditTxType = pgEnum("credit_tx_type", [
  "purchase",
  "reserve",
  "capture",
  "release",
  "signup_bonus",
  "referral_reward",
  "promo",
  "admin_grant",
  "admin_revoke",
  "refund_revoke",
]);
export const referralStatus = pgEnum("referral_status", ["pending", "qualified", "rewarded", "blocked"]);
export const productKind = pgEnum("product_kind", ["credit_pack", "single_slideshow", "single_video_short", "single_video_long"]);
export const channelPostStatus = pgEnum("channel_post_status", ["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);
export const campaignType = pgEnum("campaign_type", ["channel", "blogger", "ads", "partner", "other"]);
export const adminRole = pgEnum("admin_role", ["owner", "admin", "support"]);
export const ticketStatus = pgEnum("ticket_status", ["open", "answered", "closed"]);
export const aiUsageKind = pgEnum("ai_usage_kind", ["stt", "llm", "image", "video"]);

export const ACTIVE_JOB_STATUSES = [
  "queued",
  "analyzing",
  "preparing_scenes",
  "generating_images",
  "generating_video",
  "rendering",
] as const;

// ─── Users ──────────────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: campaignType("type").notNull().default("other"),
    /** Optional partner (blogger) account that owns the campaign — for future revenue share. */
    partnerUserId: uuid("partner_user_id"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("campaigns_code_uq").on(t.code)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    photoUrl: text("photo_url"),
    telegramLanguage: text("telegram_language"),
    /** Preferred UI language: 'ru' | 'en'. */
    language: text("language").notNull().default("ru"),
    isPremium: boolean("is_premium").notNull().default(false),
    status: userStatus("status").notNull().default("active"),
    restrictedReason: text("restricted_reason"),
    referralCode: text("referral_code").notNull(),
    referredBy: uuid("referred_by"),
    /** Raw start parameter / attribution source at registration (ref_xxx, c_xxx, channel …). */
    referralSource: text("referral_source"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    creditsBalance: integer("credits_balance").notNull().default(0),
    creditsReserved: integer("credits_reserved").notNull().default(0),
    freeSlideshowsUsed: integer("free_slideshows_used").notNull().default(0),
    hasPaid: boolean("has_paid").notNull().default(false),
    firstPurchaseAt: ts("first_purchase_at"),
    /** true once the user has a private chat with the bot (we can message them). */
    botChatAvailable: boolean("bot_chat_available").notNull().default(false),
    lastSeenAt: ts("last_seen_at"),
    lastRemindedOn: date("last_reminded_on", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("users_telegram_id_uq").on(t.telegramId),
    uniqueIndex("users_referral_code_uq").on(t.referralCode),
    index("users_referred_by_idx").on(t.referredBy),
    index("users_campaign_idx").on(t.campaignId),
    index("users_created_at_idx").on(t.createdAt),
    check("users_credits_balance_nonneg", sql`${t.creditsBalance} >= 0`),
    check("users_credits_reserved_nonneg", sql`${t.creditsReserved} >= 0`),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  notifications: jsonb("notifications").$type<NotificationPrefs>().notNull().default({ generationReady: true, reminders: false, reminderTime: "08:30", product: false }),
  timezone: text("timezone"),
  defaultStyle: text("default_style"),
  /** Per-user override of the audio retention policy (days). null = global default. */
  audioRetentionDays: integer("audio_retention_days"),
  updatedAt: updatedAt(),
});

// ─── Styles & music ─────────────────────────────────────────────────────────

export const visualStyles = pgTable("visual_styles", {
  id: text("id").primaryKey(),
  nameRu: text("name_ru").notNull(),
  nameEn: text("name_en").notNull(),
  promptPrefix: text("prompt_prefix").notNull(),
  promptSuffix: text("prompt_suffix").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  /** CSS gradient used as a swatch in the UI. */
  swatch: text("swatch").notNull().default("linear-gradient(135deg,#1b1840,#5b3fd1)"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const musicTracks = pgTable(
  "music_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = shared library track managed by admins; otherwise a user's own upload. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    license: text("license").notNull(),
    storageKey: text("storage_key").notNull(),
    durationSec: real("duration_sec"),
    isGenerated: boolean("is_generated").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("music_tracks_owner_idx").on(t.ownerUserId)],
);

// ─── Dreams ─────────────────────────────────────────────────────────────────

export const dreams = pgTable(
  "dreams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    titleEditedByUser: boolean("title_edited_by_user").notNull().default(false),
    summary: text("summary"),
    originalText: text("original_text"),
    editedText: text("edited_text"),
    originalAudioKey: text("original_audio_key"),
    audioMime: text("audio_mime"),
    audioDurationSec: real("audio_duration_sec"),
    audioDeletedAt: ts("audio_deleted_at"),
    language: text("language"),
    atmosphere: text("atmosphere"),
    visualStyle: text("visual_style"),
    status: dreamStatus("status").notNull().default("draft"),
    source: dreamSource("source").notNull(),
    bible: jsonb("bible").$type<DreamBible>(),
    analysisVersion: integer("analysis_version").notNull().default(0),
    /** sha256 of the text the current analysis was built from. */
    analysisTextHash: text("analysis_text_hash"),
    analysisProvider: text("analysis_provider"),
    analysisIsDemo: boolean("analysis_is_demo").notNull().default(false),
    transcriptionIsDemo: boolean("transcription_is_demo").notNull().default(false),
    isFavorite: boolean("is_favorite").notNull().default(false),
    coverMediaId: uuid("cover_media_id"),
    /** Explicit owner consent to feature this dream's result in the public channel. */
    publicationConsentAt: ts("publication_consent_at"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("dreams_user_created_idx").on(t.userId, t.createdAt),
    index("dreams_status_idx").on(t.status),
    index("dreams_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("dreams_text_trgm_idx").using("gin", sql`${t.editedText} gin_trgm_ops`),
  ],
);

export const dreamScenes = pgTable(
  "dream_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dreamId: uuid("dream_id")
      .notNull()
      .references(() => dreams.id, { onDelete: "cascade" }),
    analysisVersion: integer("analysis_version").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    title: text("title"),
    description: text("description").notNull(),
    action: text("action"),
    mood: text("mood"),
    imagePrompt: text("image_prompt").notNull(),
    videoPrompt: text("video_prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    cameraAngle: text("camera_angle"),
    composition: text("composition"),
    motion: text("motion"),
    characters: jsonb("characters").$type<string[]>().notNull().default([]),
    location: text("location"),
    importance: integer("importance").notNull().default(2),
    referenceAssets: jsonb("reference_assets").$type<SceneReferenceAsset[]>().notNull().default([]),
    durationSec: real("duration_sec").notNull().default(4),
    seed: integer("seed"),
    status: sceneStatus("status").notNull().default("pending"),
    currentImageId: uuid("current_image_id"),
    currentClipId: uuid("current_clip_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("dream_scenes_version_seq_uq").on(t.dreamId, t.analysisVersion, t.sequenceNumber)],
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dreamId: uuid("dream_id")
      .notNull()
      .references(() => dreams.id, { onDelete: "cascade" }),
    mediaType: outputFormat("media_type").notNull(),
    kind: jobKind("kind").notNull().default("full"),
    sceneId: uuid("scene_id").references(() => dreamScenes.id, { onDelete: "set null" }),
    status: jobStatus("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    currentStage: text("current_stage"),
    stageDetail: jsonb("stage_detail").$type<StageDetail>(),
    options: jsonb("options").$type<JobOptions>().notNull(),
    provider: text("provider"),
    model: text("model"),
    videoProvider: text("video_provider"),
    videoModel: text("video_model"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    creditsCost: integer("credits_cost").notNull().default(0),
    creditState: creditState("credit_state").notNull().default("none"),
    usedFreeAllowance: boolean("used_free_allowance").notNull().default(false),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4, mode: "number" }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    resultMediaId: uuid("result_media_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    heartbeatAt: ts("heartbeat_at"),
    queuedAt: ts("queued_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    notifiedAt: ts("notified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("generation_jobs_user_idx").on(t.userId, t.createdAt),
    index("generation_jobs_dream_idx").on(t.dreamId),
    index("generation_jobs_status_idx").on(t.status, t.heartbeatAt),
    uniqueIndex("generation_jobs_idem_uq").on(t.userId, t.idempotencyKey),
    // One active full generation per dream and format — protects against duplicate paid jobs.
    uniqueIndex("generation_jobs_active_full_uq")
      .on(t.dreamId, t.mediaType)
      .where(sql`kind in ('full','rerender') and status in ('queued','analyzing','preparing_scenes','generating_images','generating_video','rendering')`),
    uniqueIndex("generation_jobs_active_scene_uq")
      .on(t.sceneId, t.kind)
      .where(sql`kind in ('scene_image','scene_video') and status in ('queued','analyzing','preparing_scenes','generating_images','generating_video','rendering')`),
    check("generation_jobs_progress_range", sql`${t.progress} between 0 and 100`),
  ],
);

export const dreamMedia = pgTable(
  "dream_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dreamId: uuid("dream_id")
      .notNull()
      .references(() => dreams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => dreamScenes.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    mediaType: mediaType("media_type").notNull(),
    /** File format: png | jpg | webp | mp4 */
    format: text("format").notNull(),
    storageKey: text("storage_key"),
    thumbnailKey: text("thumbnail_key"),
    durationSec: real("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: mediaStatus("status").notNull().default("pending"),
    provider: text("provider"),
    model: text("model"),
    seed: integer("seed"),
    prompt: text("prompt"),
    /** Hash of all inputs that determine this asset — enables cache reuse. */
    inputHash: text("input_hash"),
    /** External provider task id (video) — lets the worker resume polling after a restart. */
    externalJobId: text("external_job_id"),
    characterKey: text("character_key"),
    styleId: text("style_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    hasWatermark: boolean("has_watermark").notNull().default(false),
    telegramFileId: text("telegram_file_id"),
    version: integer("version").notNull().default(1),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("dream_media_dream_type_idx").on(t.dreamId, t.mediaType, t.status),
    index("dream_media_scene_idx").on(t.sceneId),
    index("dream_media_input_hash_idx").on(t.dreamId, t.inputHash),
    index("dream_media_job_idx").on(t.jobId),
  ],
);

// ─── Money ──────────────────────────────────────────────────────────────────

export const pricingPlans = pgTable("pricing_plans", {
  id: text("id").primaryKey(),
  kind: productKind("kind").notNull(),
  titleRu: text("title_ru").notNull(),
  titleEn: text("title_en").notNull(),
  descriptionRu: text("description_ru").notNull().default(""),
  descriptionEn: text("description_en").notNull().default(""),
  starsPrice: integer("stars_price").notNull(),
  credits: integer("credits").notNull(),
  badge: text("badge"),
  /** Paid purchases may remove the watermark for results. */
  removesWatermark: boolean("removes_watermark").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const actionPrices = pgTable("action_prices", {
  /** slideshow | video_short | video_medium | video_long | scene_image | scene_video | rerender */
  action: text("action").primaryKey(),
  credits: integer("credits").notNull(),
  updatedAt: updatedAt(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    productId: text("product_id").references(() => pricingPlans.id, { onDelete: "set null" }),
    starsAmount: integer("stars_amount").notNull(),
    creditsAmount: integer("credits_amount").notNull(),
    currency: text("currency").notNull().default("XTR"),
    status: paymentStatus("status").notNull().default("pending"),
    /** Payload embedded in the invoice — equals the payment id; validated at pre_checkout. */
    invoicePayload: text("invoice_payload").notNull(),
    telegramPaymentChargeId: text("telegram_payment_charge_id"),
    providerPaymentChargeId: text("provider_payment_charge_id"),
    /** Optional generation to start automatically after payment. */
    intent: jsonb("intent").$type<{ dreamId: string; mediaType: "slideshow" | "video"; options: JobOptions; idempotencyKey: string } | null>(),
    refundedAt: ts("refunded_at"),
    refundReason: text("refund_reason"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_charge_uq").on(t.telegramPaymentChargeId),
    uniqueIndex("payments_payload_uq").on(t.invoicePayload),
    index("payments_user_idx").on(t.userId, t.createdAt),
    index("payments_status_idx").on(t.status, t.createdAt),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedId: uuid("invited_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: referralStatus("status").notNull().default("pending"),
    rewardInviter: integer("reward_inviter").notNull().default(0),
    rewardInvited: integer("reward_invited").notNull().default(0),
    qualifiedAt: ts("qualified_at"),
    rewardedAt: ts("rewarded_at"),
    blockedReason: text("blocked_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("referrals_invited_uq").on(t.invitedId), index("referrals_inviter_idx").on(t.inviterId)],
);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    credits: integer("credits").notNull(),
    maxRedemptions: integer("max_redemptions"),
    redemptionsCount: integer("redemptions_count").notNull().default(0),
    expiresAt: ts("expires_at"),
    onlyNewUsers: boolean("only_new_users").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("promo_codes_code_uq").on(t.code)],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("promo_redemptions_uq").on(t.promoId, t.userId)],
);

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Signed change of the available balance. */
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    type: creditTxType("type").notNull(),
    source: text("source"),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    referralId: uuid("referral_id").references(() => referrals.id, { onDelete: "set null" }),
    promoRedemptionId: uuid("promo_redemption_id").references(() => promoRedemptions.id, { onDelete: "set null" }),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_tx_user_idx").on(t.userId, t.createdAt),
    // Idempotency guards: each event can only move credits once.
    uniqueIndex("credit_tx_job_type_uq").on(t.jobId, t.type).where(sql`${t.jobId} is not null`),
    uniqueIndex("credit_tx_payment_type_uq").on(t.paymentId, t.type).where(sql`${t.paymentId} is not null`),
    uniqueIndex("credit_tx_referral_user_uq").on(t.referralId, t.userId).where(sql`${t.referralId} is not null`),
    uniqueIndex("credit_tx_promo_uq").on(t.promoRedemptionId).where(sql`${t.promoRedemptionId} is not null`),
    uniqueIndex("credit_tx_signup_uq").on(t.userId).where(sql`${t.type} = 'signup_bonus'`),
  ],
);

// ─── Settings, sharing, channel, support ───────────────────────────────────

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: bigint("updated_by", { mode: "number" }),
  updatedAt: updatedAt(),
});

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dreamId: uuid("dream_id")
      .notNull()
      .references(() => dreams.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => dreamMedia.id, { onDelete: "cascade" }),
    showTitle: boolean("show_title").notNull().default(true),
    showText: boolean("show_text").notNull().default(false),
    views: integer("views").notNull().default(0),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("share_links_token_uq").on(t.token), index("share_links_dream_idx").on(t.dreamId)],
);

export const channelPosts = pgTable(
  "channel_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dreamId: uuid("dream_id").references(() => dreams.id, { onDelete: "set null" }),
    mediaId: uuid("media_id").references(() => dreamMedia.id, { onDelete: "set null" }),
    media: jsonb("media").$type<ChannelPostMediaRef | null>(),
    caption: text("caption").notNull(),
    buttonText: text("button_text"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    status: channelPostStatus("status").notNull().default("draft"),
    scheduledAt: ts("scheduled_at"),
    publishedAt: ts("published_at"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    error: text("error"),
    createdBy: bigint("created_by", { mode: "number" }),
    approvedBy: bigint("approved_by", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("channel_posts_status_idx").on(t.status, t.scheduledAt)],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }),
    topic: text("topic").notNull().default("general"),
    message: text("message").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    status: ticketStatus("status").notNull().default("open"),
    reply: text("reply"),
    repliedBy: bigint("replied_by", { mode: "number" }),
    repliedAt: ts("replied_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_tickets_status_idx").on(t.status, t.createdAt)],
);

// ─── Analytics, AI usage, admin ─────────────────────────────────────────────

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source").notNull().default("server"),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_name_created_idx").on(t.name, t.createdAt), index("analytics_user_created_idx").on(t.userId, t.createdAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    dreamId: uuid("dream_id").references(() => dreams.id, { onDelete: "set null" }),
    kind: aiUsageKind("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    units: real("units").notNull().default(1),
    unit: text("unit").notNull().default("request"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    isDemo: boolean("is_demo").notNull().default(false),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_job_idx").on(t.jobId)],
);

/**
 * Minimal anti-abuse marker kept after an account is erased: a keyed hash of the
 * Telegram id (not reversible without the server secret) and the free allowance
 * already consumed — so deleting and re-registering doesn't mint new free
 * generations, signup bonuses or referral rewards. Contains no profile data.
 */
export const deletedAccountMarkers = pgTable("deleted_account_markers", {
  telegramIdHash: text("telegram_id_hash").primaryKey(),
  freeSlideshowsUsed: integer("free_slideshows_used").notNull().default(0),
  deletedAt: createdAt(),
});

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    role: adminRole("role").notNull().default("admin"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("admin_users_telegram_uq").on(t.telegramId)],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);
