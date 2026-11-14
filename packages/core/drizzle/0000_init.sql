CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'support');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_kind" AS ENUM('stt', 'llm', 'image', 'video');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('channel', 'blogger', 'ads', 'partner', 'other');--> statement-breakpoint
CREATE TYPE "public"."channel_post_status" AS ENUM('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credit_state" AS ENUM('none', 'reserved', 'captured', 'released');--> statement-breakpoint
CREATE TYPE "public"."credit_tx_type" AS ENUM('purchase', 'reserve', 'capture', 'release', 'signup_bonus', 'referral_reward', 'promo', 'admin_grant', 'admin_revoke', 'refund_revoke');--> statement-breakpoint
CREATE TYPE "public"."dream_source" AS ENUM('miniapp_voice', 'miniapp_text', 'bot_voice', 'bot_text');--> statement-breakpoint
CREATE TYPE "public"."dream_status" AS ENUM('draft', 'transcribing', 'transcription_failed', 'review', 'analyzing', 'analysis_failed', 'ready');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('full', 'scene_image', 'scene_video', 'rerender');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'analyzing', 'preparing_scenes', 'generating_images', 'generating_video', 'rendering', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'reference', 'video_clip', 'slideshow', 'video');--> statement-breakpoint
CREATE TYPE "public"."output_format" AS ENUM('slideshow', 'video');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'refunded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('credit_pack', 'single_slideshow', 'single_video_short', 'single_video_long');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'qualified', 'rewarded', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."scene_status" AS ENUM('pending', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'restricted', 'banned', 'deleted');--> statement-breakpoint
CREATE TABLE "action_prices" (
	"action" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_telegram_id" bigint NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"payload" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"job_id" uuid,
	"dream_id" uuid,
	"kind" "ai_usage_kind" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"units" real DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'request' NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'server' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "campaign_type" DEFAULT 'other' NOT NULL,
	"partner_user_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid,
	"media_id" uuid,
	"media" jsonb,
	"caption" text NOT NULL,
	"button_text" text,
	"campaign_id" uuid,
	"status" "channel_post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"error" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" "credit_tx_type" NOT NULL,
	"source" text,
	"job_id" uuid,
	"payment_id" uuid,
	"referral_id" uuid,
	"promo_redemption_id" uuid,
	"admin_telegram_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dream_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scene_id" uuid,
	"job_id" uuid,
	"media_type" "media_type" NOT NULL,
	"format" text NOT NULL,
	"storage_key" text,
	"thumbnail_key" text,
	"duration_sec" real,
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"provider" text,
	"model" text,
	"seed" integer,
	"prompt" text,
	"input_hash" text,
	"external_job_id" text,
	"character_key" text,
	"style_id" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"has_watermark" boolean DEFAULT false NOT NULL,
	"telegram_file_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"cost_usd" numeric(10, 4),
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dream_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dream_id" uuid NOT NULL,
	"analysis_version" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"title" text,
	"description" text NOT NULL,
	"action" text,
	"mood" text,
	"image_prompt" text NOT NULL,
	"video_prompt" text NOT NULL,
	"negative_prompt" text,
	"camera_angle" text,
	"composition" text,
	"motion" text,
	"characters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" text,
	"importance" integer DEFAULT 2 NOT NULL,
	"reference_assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_sec" real DEFAULT 4 NOT NULL,
	"seed" integer,
	"status" "scene_status" DEFAULT 'pending' NOT NULL,
	"current_image_id" uuid,
	"current_clip_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"title_edited_by_user" boolean DEFAULT false NOT NULL,
	"summary" text,
	"original_text" text,
	"edited_text" text,
	"original_audio_key" text,
	"audio_mime" text,
	"audio_duration_sec" real,
	"audio_deleted_at" timestamp with time zone,
	"language" text,
	"atmosphere" text,
	"visual_style" text,
	"status" "dream_status" DEFAULT 'draft' NOT NULL,
	"source" "dream_source" NOT NULL,
	"bible" jsonb,
	"analysis_version" integer DEFAULT 0 NOT NULL,
	"analysis_text_hash" text,
	"analysis_provider" text,
	"analysis_is_demo" boolean DEFAULT false NOT NULL,
	"transcription_is_demo" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"cover_media_id" uuid,
	"publication_consent_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dream_id" uuid NOT NULL,
	"media_type" "output_format" NOT NULL,
	"kind" "job_kind" DEFAULT 'full' NOT NULL,
	"scene_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"current_stage" text,
	"stage_detail" jsonb,
	"options" jsonb NOT NULL,
	"provider" text,
	"model" text,
	"video_provider" text,
	"video_model" text,
	"error_code" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"credit_state" "credit_state" DEFAULT 'none' NOT NULL,
	"used_free_allowance" boolean DEFAULT false NOT NULL,
	"estimated_cost_usd" numeric(10, 4),
	"actual_cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"result_media_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_progress_range" CHECK ("generation_jobs"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"title" text NOT NULL,
	"artist" text,
	"license" text NOT NULL,
	"storage_key" text NOT NULL,
	"duration_sec" real,
	"is_generated" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"telegram_user_id" bigint,
	"product_id" text,
	"stars_amount" integer NOT NULL,
	"credits_amount" integer NOT NULL,
	"currency" text DEFAULT 'XTR' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"invoice_payload" text NOT NULL,
	"telegram_payment_charge_id" text,
	"provider_payment_charge_id" text,
	"intent" jsonb,
	"refunded_at" timestamp with time zone,
	"refund_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "product_kind" NOT NULL,
	"title_ru" text NOT NULL,
	"title_en" text NOT NULL,
	"description_ru" text DEFAULT '' NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"stars_price" integer NOT NULL,
	"credits" integer NOT NULL,
	"badge" text,
	"removes_watermark" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"credits" integer NOT NULL,
	"max_redemptions" integer,
	"redemptions_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"only_new_users" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invited_id" uuid NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"reward_inviter" integer DEFAULT 0 NOT NULL,
	"reward_invited" integer DEFAULT 0 NOT NULL,
	"qualified_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"dream_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"show_title" boolean DEFAULT true NOT NULL,
	"show_text" boolean DEFAULT false NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"telegram_user_id" bigint,
	"topic" text DEFAULT 'general' NOT NULL,
	"message" text NOT NULL,
	"payment_id" uuid,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"reply" text,
	"replied_by" bigint,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notifications" jsonb DEFAULT '{"generationReady":true,"reminders":false,"reminderTime":"08:30","product":false}'::jsonb NOT NULL,
	"timezone" text,
	"default_style" text,
	"audio_retention_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"photo_url" text,
	"telegram_language" text,
	"language" text DEFAULT 'ru' NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"restricted_reason" text,
	"referral_code" text NOT NULL,
	"referred_by" uuid,
	"referral_source" text,
	"campaign_id" uuid,
	"credits_balance" integer DEFAULT 0 NOT NULL,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"free_slideshows_used" integer DEFAULT 0 NOT NULL,
	"has_paid" boolean DEFAULT false NOT NULL,
	"first_purchase_at" timestamp with time zone,
	"bot_chat_available" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_reminded_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_credits_balance_nonneg" CHECK ("users"."credits_balance" >= 0),
	CONSTRAINT "users_credits_reserved_nonneg" CHECK ("users"."credits_reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "visual_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text NOT NULL,
	"prompt_prefix" text NOT NULL,
	"prompt_suffix" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"swatch" text DEFAULT 'linear-gradient(135deg,#1b1840,#5b3fd1)' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_media_id_dream_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."dream_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_promo_redemption_id_promo_redemptions_id_fk" FOREIGN KEY ("promo_redemption_id") REFERENCES "public"."promo_redemptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_media" ADD CONSTRAINT "dream_media_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_media" ADD CONSTRAINT "dream_media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_media" ADD CONSTRAINT "dream_media_scene_id_dream_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."dream_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_media" ADD CONSTRAINT "dream_media_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_scenes" ADD CONSTRAINT "dream_scenes_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dreams" ADD CONSTRAINT "dreams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_scene_id_dream_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."dream_scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_product_id_pricing_plans_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pricing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invited_id_users_id_fk" FOREIGN KEY ("invited_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_dream_id_dreams_id_fk" FOREIGN KEY ("dream_id") REFERENCES "public"."dreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_media_id_dream_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."dream_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_telegram_uq" ON "admin_users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_job_idx" ON "ai_usage" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "analytics_name_created_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "analytics_user_created_idx" ON "analytics_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_code_uq" ON "campaigns" USING btree ("code");--> statement-breakpoint
CREATE INDEX "channel_posts_status_idx" ON "channel_posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "credit_tx_user_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_job_type_uq" ON "credit_transactions" USING btree ("job_id","type") WHERE "credit_transactions"."job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_payment_type_uq" ON "credit_transactions" USING btree ("payment_id","type") WHERE "credit_transactions"."payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_referral_user_uq" ON "credit_transactions" USING btree ("referral_id","user_id") WHERE "credit_transactions"."referral_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_promo_uq" ON "credit_transactions" USING btree ("promo_redemption_id") WHERE "credit_transactions"."promo_redemption_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_signup_uq" ON "credit_transactions" USING btree ("user_id") WHERE "credit_transactions"."type" = 'signup_bonus';--> statement-breakpoint
CREATE INDEX "dream_media_dream_type_idx" ON "dream_media" USING btree ("dream_id","media_type","status");--> statement-breakpoint
CREATE INDEX "dream_media_scene_idx" ON "dream_media" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "dream_media_input_hash_idx" ON "dream_media" USING btree ("dream_id","input_hash");--> statement-breakpoint
CREATE INDEX "dream_media_job_idx" ON "dream_media" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dream_scenes_version_seq_uq" ON "dream_scenes" USING btree ("dream_id","analysis_version","sequence_number");--> statement-breakpoint
CREATE INDEX "dreams_user_created_idx" ON "dreams" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "dreams_status_idx" ON "dreams" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dreams_title_trgm_idx" ON "dreams" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "dreams_text_trgm_idx" ON "dreams" USING gin ("edited_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "generation_jobs_user_idx" ON "generation_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_dream_idx" ON "generation_jobs" USING btree ("dream_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_idem_uq" ON "generation_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_active_full_uq" ON "generation_jobs" USING btree ("dream_id","media_type") WHERE kind in ('full','rerender') and status in ('queued','analyzing','preparing_scenes','generating_images','generating_video','rendering');--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_active_scene_uq" ON "generation_jobs" USING btree ("scene_id","kind") WHERE kind in ('scene_image','scene_video') and status in ('queued','analyzing','preparing_scenes','generating_images','generating_video','rendering');--> statement-breakpoint
CREATE INDEX "music_tracks_owner_idx" ON "music_tracks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_charge_uq" ON "payments" USING btree ("telegram_payment_charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_payload_uq" ON "payments" USING btree ("invoice_payload");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_uq" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_uq" ON "promo_redemptions" USING btree ("promo_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invited_uq" ON "referrals" USING btree ("invited_id");--> statement-breakpoint
CREATE INDEX "referrals_inviter_idx" ON "referrals" USING btree ("inviter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_uq" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "share_links_dream_idx" ON "share_links" USING btree ("dream_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uq" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "users_campaign_idx" ON "users" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");