import { and, asc, eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "../db/client";
import { actionPrices, pricingPlans } from "../db/schema";
import type { ProductDto } from "../dto";
import type { Locale } from "../i18n";

/** Pricing actions. Costs are configured by admins in `action_prices` — never hardcoded in the UI. */
export const PRICE_ACTIONS = ["slideshow", "video_short", "video_medium", "video_long", "scene_image", "scene_video", "rerender"] as const;
export type PriceAction = (typeof PRICE_ACTIONS)[number];

export const DEFAULT_ACTION_PRICES: Record<PriceAction, number> = {
  slideshow: 10,
  video_short: 40,
  video_medium: 80,
  video_long: 150,
  scene_image: 2,
  scene_video: 12,
  rerender: 0,
};

export async function getActionPrices(db: DbOrTx = getDb()): Promise<Record<PriceAction, number>> {
  const rows = await db.select().from(actionPrices);
  const out = { ...DEFAULT_ACTION_PRICES };
  for (const r of rows) if ((PRICE_ACTIONS as readonly string[]).includes(r.action)) out[r.action as PriceAction] = r.credits;
  return out;
}

export async function setActionPrice(action: PriceAction, credits: number): Promise<void> {
  await getDb()
    .insert(actionPrices)
    .values({ action, credits })
    .onConflictDoUpdate({ target: actionPrices.action, set: { credits, updatedAt: new Date() } });
}

export type PricingPlan = typeof pricingPlans.$inferSelect;

export async function listActiveProducts(db: DbOrTx = getDb()): Promise<PricingPlan[]> {
  return db.select().from(pricingPlans).where(eq(pricingPlans.isActive, true)).orderBy(asc(pricingPlans.sortOrder), asc(pricingPlans.starsPrice));
}

export async function getProduct(id: string, db: DbOrTx = getDb()): Promise<PricingPlan | undefined> {
  const [p] = await db.select().from(pricingPlans).where(and(eq(pricingPlans.id, id), eq(pricingPlans.isActive, true)));
  return p;
}

export function productDto(p: PricingPlan, locale: Locale): ProductDto {
  return {
    id: p.id,
    kind: p.kind,
    title: locale === "en" ? p.titleEn : p.titleRu,
    description: locale === "en" ? p.descriptionEn : p.descriptionRu,
    stars: p.starsPrice,
    credits: p.credits,
    badge: p.badge,
  };
}
