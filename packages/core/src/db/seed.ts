import { sql } from "drizzle-orm";
import { env } from "../env";
import { logger } from "../logger";
import { DEFAULT_ACTION_PRICES } from "../services/pricing";
import { getDb } from "./client";
import { actionPrices, adminUsers, pricingPlans, visualStyles } from "./schema";

/** Default catalogue. Inserted only when missing — admin edits are never overwritten. */
export const DEFAULT_STYLES = [
  {
    id: "cinematic",
    nameRu: "Кинематографичный",
    nameEn: "Cinematic",
    promptPrefix: "Cinematic film still, anamorphic lens, dramatic volumetric light, rich color grading, shallow depth of field",
    promptSuffix: "award-winning cinematography, highly detailed",
    negativePrompt: "cartoon, flat illustration, low quality, blurry, oversaturated",
    swatch: "linear-gradient(135deg,#0d1b2a 0%,#3a2d6b 55%,#c8a2ff 100%)",
    sortOrder: 0,
  },
  {
    id: "auto",
    nameRu: "Авто",
    nameEn: "Auto",
    promptPrefix: "Dreamlike cinematic image",
    promptSuffix: "highly detailed, atmospheric",
    negativePrompt: "low quality, blurry",
    swatch: "conic-gradient(from 210deg,#5b3fd1,#b9a8ff,#6fc2b0,#5b3fd1)",
    sortOrder: 1,
  },
  {
    id: "realism",
    nameRu: "Реализм",
    nameEn: "Realism",
    promptPrefix: "Photorealistic photograph, natural light, realistic textures, 35mm photo",
    promptSuffix: "high detail, true-to-life colors",
    negativePrompt: "painting, cartoon, anime, illustration, CGI look",
    swatch: "linear-gradient(135deg,#1d2b2f 0%,#55706b 60%,#d9cfb8 100%)",
    sortOrder: 2,
  },
  {
    id: "anime",
    nameRu: "Аниме",
    nameEn: "Anime",
    promptPrefix: "Anime key visual, detailed cel shading, painterly background, luminous sky",
    promptSuffix: "modern Japanese animated film quality",
    negativePrompt: "photorealistic, 3d render, low quality",
    swatch: "linear-gradient(135deg,#1b2a6b 0%,#6a7bff 50%,#ffb3d1 100%)",
    sortOrder: 3,
  },
  {
    id: "cartoon",
    nameRu: "Мультфильм",
    nameEn: "Cartoon",
    promptPrefix: "Stylized 3D animated film still, soft rounded shapes, expressive characters, gentle global illumination",
    promptSuffix: "family animation quality",
    negativePrompt: "photorealistic, gritty, horror",
    swatch: "linear-gradient(135deg,#243b55 0%,#5fa8d3 50%,#ffd38a 100%)",
    sortOrder: 4,
  },
  {
    id: "surreal",
    nameRu: "Сюрреализм",
    nameEn: "Surreal",
    promptPrefix: "Surrealist painting, impossible geometry, dreamlike symbolism, soft melting reality, oil on canvas texture",
    promptSuffix: "museum quality surrealism",
    negativePrompt: "mundane, low quality, text",
    swatch: "linear-gradient(135deg,#3d1e3a 0%,#c06c84 50%,#f8b195 100%)",
    sortOrder: 5,
  },
  {
    id: "dark_fantasy",
    nameRu: "Тёмная фантастика",
    nameEn: "Dark fantasy",
    promptPrefix: "Dark fantasy concept art, gothic atmosphere, deep shadows, drifting mist, muted palette with glowing accents",
    promptSuffix: "epic, moody, intricate detail",
    negativePrompt: "bright cheerful colors, cartoon, gore",
    swatch: "linear-gradient(135deg,#07070d 0%,#2a1a3f 55%,#7a3b5c 100%)",
    sortOrder: 6,
  },
  {
    id: "watercolor",
    nameRu: "Акварель",
    nameEn: "Watercolor",
    promptPrefix: "Delicate watercolor illustration, soft bleeding pigments, visible paper texture, airy light",
    promptSuffix: "hand-painted, gentle",
    negativePrompt: "photorealistic, harsh lines, 3d render",
    swatch: "linear-gradient(135deg,#a8c0d8 0%,#d7c4e8 50%,#f2e2c4 100%)",
    sortOrder: 7,
  },
];

export const DEFAULT_PLANS: (typeof pricingPlans.$inferInsert)[] = [
  { id: "single_slideshow", kind: "single_slideshow", titleRu: "Одно слайд-шоу", titleEn: "One slideshow", descriptionRu: "Кредиты на одну генерацию слайд-шоу", descriptionEn: "Credits for one slideshow", starsPrice: 25, credits: 10, sortOrder: 10 },
  { id: "single_video_short", kind: "single_video_short", titleRu: "Короткое видео", titleEn: "Short video", descriptionRu: "Кредиты на AI-видео до 15 секунд", descriptionEn: "Credits for an AI video up to 15 s", starsPrice: 89, credits: 40, sortOrder: 11 },
  { id: "single_video_long", kind: "single_video_long", titleRu: "Длинное видео", titleEn: "Long video", descriptionRu: "Кредиты на AI-видео до 60 секунд", descriptionEn: "Credits for an AI video up to 60 s", starsPrice: 349, credits: 180, sortOrder: 12 },
  { id: "pack_small", kind: "credit_pack", titleRu: "Малый пакет", titleEn: "Small pack", descriptionRu: "50 кредитов", descriptionEn: "50 credits", starsPrice: 99, credits: 50, sortOrder: 20 },
  { id: "pack_medium", kind: "credit_pack", titleRu: "Средний пакет", titleEn: "Medium pack", descriptionRu: "150 кредитов", descriptionEn: "150 credits", starsPrice: 249, credits: 150, badge: "popular", sortOrder: 21 },
  { id: "pack_large", kind: "credit_pack", titleRu: "Большой пакет", titleEn: "Large pack", descriptionRu: "450 кредитов", descriptionEn: "450 credits", starsPrice: 649, credits: 450, badge: "best_value", sortOrder: 22 },
];

export async function seedDefaults(): Promise<void> {
  const db = getDb();
  await db.insert(visualStyles).values(DEFAULT_STYLES).onConflictDoNothing();
  await db.insert(pricingPlans).values(DEFAULT_PLANS).onConflictDoNothing();
  await db
    .insert(actionPrices)
    .values(Object.entries({ ...DEFAULT_ACTION_PRICES, video_medium: 90, video_long: 180 }).map(([action, credits]) => ({ action, credits })))
    .onConflictDoNothing();
  const admins = env().ADMIN_TELEGRAM_IDS.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  for (const id of admins) {
    await db.insert(adminUsers).values({ telegramId: id, role: "owner", note: "from ADMIN_TELEGRAM_IDS" }).onConflictDoNothing();
  }
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(visualStyles);
  logger.info("seed complete", { styles: n, admins: admins.length });
}
