"use server";

import { z } from "zod";
import { setProductActive, upsertProduct } from "@dream/core/services/admin-ops";
import { getActionPrices, PRICE_ACTIONS, setActionPrice } from "@dream/core/services/pricing";
import { updateSettings } from "@dream/core/settings";
import { adminAction, zCheckbox, zInt, zNum, zText } from "@/server/admin/action";

export const savePricesAction = adminAction({
  name: "pricing.actions",
  revalidate: ["/admin/monetization"],
  schema: z.object(Object.fromEntries(PRICE_ACTIONS.map((a) => [a, zInt(0, 100_000)])) as Record<(typeof PRICE_ACTIONS)[number], ReturnType<typeof zInt>>),
  async run(input) {
    const before = await getActionPrices();
    const changed: Record<string, [number, number]> = {};
    for (const action of PRICE_ACTIONS) {
      const value = input[action];
      if (before[action] !== value) {
        await setActionPrice(action, value);
        changed[action] = [before[action], value];
      }
    }
    return { message: Object.keys(changed).length ? `Обновлено цен: ${Object.keys(changed).length}` : "Изменений нет", target: { type: "settings", id: "action_prices" }, payload: changed };
  },
});

const productSchema = z.object({
  id: zText(40, 2),
  kind: z.enum(["credit_pack", "single_slideshow", "single_video_short", "single_video_long"]),
  titleRu: zText(32, 1),
  titleEn: zText(32, 1),
  descriptionRu: zText(255),
  descriptionEn: zText(255),
  starsPrice: zInt(1, 100_000),
  credits: zInt(1, 1_000_000),
  badge: z.enum(["", "popular", "best_value", "new"]).transform((v) => (v ? v : null)),
  removesWatermark: zCheckbox,
  sortOrder: zInt(-1000, 1000),
  isActive: zCheckbox,
});

export const saveProductAction = adminAction({
  name: "product.upsert",
  revalidate: ["/admin/monetization"],
  schema: productSchema,
  async run(input) {
    await upsertProduct(input);
    return { message: `Товар «${input.titleRu}» сохранён`, target: { type: "product", id: input.id }, payload: input };
  },
});

export const toggleProductAction = adminAction({
  name: "product.toggle",
  revalidate: ["/admin/monetization"],
  schema: z.object({ id: zText(40, 2), active: z.enum(["0", "1"]) }),
  async run(input) {
    await setProductActive(input.id, input.active === "1");
    return { message: input.active === "1" ? "Товар включён" : "Товар скрыт из магазина", target: { type: "product", id: input.id }, payload: { active: input.active === "1" } };
  },
});

export const saveLimitsAction = adminAction({
  name: "settings.limits",
  revalidate: ["/admin/monetization"],
  schema: z.object({
    freeSlideshowsPerUser: zInt(0, 100),
    signupBonusCredits: zInt(0, 100_000),
    freePreviewEnabled: zCheckbox,
    freePreviewsPerDay: zInt(0, 100),
    maxDreamsPerDay: zInt(1, 1000),
    maxAnalysesPerDay: zInt(1, 1000),
    maxGenerationsPerDay: zInt(1, 1000),
    dailySpendLimitUsd: zNum(0, 1_000_000),
    freeDailySpendLimitUsd: zNum(0, 1_000_000),
  }),
  async run(input, admin) {
    await updateSettings("limits", input, admin.telegramId);
    return { message: "Лимиты сохранены", target: { type: "settings", id: "limits" }, payload: input };
  },
});

export const saveWatermarkAction = adminAction({
  name: "settings.watermark",
  revalidate: ["/admin/monetization"],
  schema: z.object({ mode: z.enum(["always", "free_only", "never"]), text: zText(60, 1) }),
  async run(input, admin) {
    await updateSettings("watermark", input, admin.telegramId);
    return { message: "Настройки водяного знака сохранены", target: { type: "settings", id: "watermark" }, payload: input };
  },
});

export const saveReferralAction = adminAction({
  name: "settings.referral",
  revalidate: ["/admin/monetization", "/admin/referrals"],
  schema: z.object({
    enabled: zCheckbox,
    rewardInviter: zInt(0, 100_000),
    rewardInvited: zInt(0, 100_000),
    trigger: z.enum(["first_dream", "first_purchase"]),
    maxRewardsPerInviterPerDay: zInt(1, 1000),
  }),
  async run(input, admin) {
    await updateSettings("referral", input, admin.telegramId);
    return { message: "Реферальная программа сохранена", target: { type: "settings", id: "referral" }, payload: input };
  },
});
