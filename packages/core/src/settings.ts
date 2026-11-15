import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "./db/client";
import { appSettings } from "./db/schema";

/**
 * Admin-editable runtime settings. Each section is stored as one row in
 * `app_settings` and validated against its schema; missing values fall back
 * to defaults so new settings never break older databases.
 */

export const ModelSelectionSchema = z.object({
  stt: z.object({ provider: z.string(), model: z.string(), language: z.enum(["auto", "ru", "en"]).default("auto") }),
  llm: z.object({ provider: z.string(), model: z.string() }),
  image: z.object({ model: z.string(), referenceModel: z.string().nullable().default(null) }),
  video: z.object({ model: z.string() }),
});

export const SettingsSchemas = {
  limits: z.object({
    /** Free slideshow generations granted to each user. */
    freeSlideshowsPerUser: z.number().int().min(0).default(1),
    /** Credits granted once on registration. */
    signupBonusCredits: z.number().int().min(0).default(0),
    /** Generate one free preview frame per dream on the format screen. */
    freePreviewEnabled: z.boolean().default(true),
    freePreviewsPerDay: z.number().int().min(0).default(3),
    maxDreamsPerDay: z.number().int().min(1).default(30),
    maxAnalysesPerDay: z.number().int().min(1).default(40),
    maxGenerationsPerDay: z.number().int().min(1).default(20),
    /** Hard daily cap on AI spend for all users (USD). 0 = unlimited. */
    dailySpendLimitUsd: z.number().min(0).default(100),
    /** Daily cap on AI spend caused by free allowances/previews (USD). */
    freeDailySpendLimitUsd: z.number().min(0).default(10),
  }),
  referral: z.object({
    enabled: z.boolean().default(true),
    rewardInviter: z.number().int().min(0).default(10),
    rewardInvited: z.number().int().min(0).default(5),
    /** When the inviter is rewarded. */
    trigger: z.enum(["first_dream", "first_purchase"]).default("first_purchase"),
    maxRewardsPerInviterPerDay: z.number().int().min(1).default(20),
  }),
  watermark: z.object({
    mode: z.enum(["always", "free_only", "never"]).default("free_only"),
    text: z.string().min(1).max(60).default("Made with DREAM AI"),
  }),
  // Best quality per dollar as of 2026-11 (see ai/models.ts for prices and alternatives).
  models: ModelSelectionSchema.default({
    stt: { provider: "openai", model: "gpt-transcribe", language: "auto" },
    llm: { provider: "anthropic", model: "claude-opus-5-5" },
    image: { model: "fal:muse-image", referenceModel: "fal:muse-image-edit" },
    video: { model: "fal:heygen-video" },
  }),
  concurrency: z.object({
    transcription: z.number().int().min(1).max(20).default(3),
    analysis: z.number().int().min(1).max(20).default(3),
    slideshow: z.number().int().min(1).max(20).default(2),
    video: z.number().int().min(1).max(10).default(1),
    /** Parallel image requests inside one job. */
    imagesPerJob: z.number().int().min(1).max(8).default(2),
    /** Parallel video clip requests inside one job. */
    clipsPerJob: z.number().int().min(1).max(6).default(2),
  }),
  generation: z.object({
    slideshowMinScenes: z.number().int().min(1).max(20).default(3),
    slideshowMaxScenes: z.number().int().min(1).max(24).default(12),
    slideshowSecondsPerScene: z.number().min(2).max(10).default(4.5),
    videoDurations: z.array(z.number().int().min(5).max(120)).default([10, 15, 30, 60]),
    maxVideoDurationSec: z.number().int().min(5).max(180).default(60),
    outputWidth: z.number().int().default(1080),
    outputHeight: z.number().int().default(1920),
    fps: z.number().int().min(24).max(60).default(30),
    jobTimeoutMinutes: z.number().int().min(5).max(240).default(60),
    maxAttempts: z.number().int().min(1).max(6).default(3),
  }),
  retention: z.object({
    /** Days to keep original voice recordings. 0 = delete right after transcription, -1 = keep forever. */
    audioRetentionDays: z.number().int().min(-1).default(30),
    /** Days before soft-deleted dreams' files are purged. */
    deletedPurgeDays: z.number().int().min(0).default(0),
  }),
  formatExamples: z.object({
    /** Optional dream_media ids of curated examples shown on the format cards. */
    slideshowMediaId: z.string().uuid().nullable().default(null),
    videoMediaId: z.string().uuid().nullable().default(null),
  }),
} as const;

export type SettingsKey = keyof typeof SettingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof SettingsSchemas)[K]> };
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

const CACHE_TTL_MS = 15_000;
let cache: { at: number; value: Settings } | undefined;

export function defaultSettings(): Settings {
  const out = {} as Record<string, unknown>;
  for (const [key, schema] of Object.entries(SettingsSchemas)) {
    out[key] = (schema as z.ZodType).parse(key === "models" ? undefined : {});
  }
  return out as Settings;
}

export async function getSettings(opts: { fresh?: boolean; db?: DbOrTx } = {}): Promise<Settings> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const db = opts.db ?? getDb();
  const rows = await db.select().from(appSettings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const [key, schema] of Object.entries(SettingsSchemas)) {
    const raw = stored.get(key);
    const parsed = (schema as z.ZodType).safeParse(raw ?? (key === "models" ? undefined : {}));
    out[key] = parsed.success ? parsed.data : (schema as z.ZodType).parse(key === "models" ? undefined : {});
  }
  const value = out as Settings;
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings<K extends SettingsKey>(key: K, value: unknown, adminTelegramId?: number): Promise<Settings[K]> {
  const parsed = SettingsSchemas[key].parse(value) as Settings[K];
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ key, value: parsed as object, updatedBy: adminTelegramId ?? null })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed as object, updatedBy: adminTelegramId ?? null, updatedAt: new Date() } });
  cache = undefined;
  return parsed;
}

export function invalidateSettingsCache(): void {
  cache = undefined;
}

export async function getRawSetting(key: string, db: DbOrTx = getDb()): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value;
}
