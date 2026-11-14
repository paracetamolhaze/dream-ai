"use server";

import { z } from "zod";
import { createPromo, setPromoActive } from "@dream/core/services/admin-ops";
import { adminAction, zCheckbox, zInt, zOptDateTime, zOptInt, zOptText, zText, zUuid } from "@/server/admin/action";

export const createPromoAction = adminAction({
  name: "promo.create",
  revalidate: ["/admin/promo"],
  schema: z.object({
    code: zText(32, 3),
    credits: zInt(1, 100_000),
    maxRedemptions: zOptInt(1, 10_000_000),
    expiresAt: zOptDateTime,
    onlyNewUsers: zCheckbox,
    note: zOptText(200),
  }),
  async run(input, admin) {
    const promo = await createPromo(input, admin.telegramId);
    return { message: `Промокод ${promo.code} создан`, target: { type: "promo", id: promo.id }, payload: { code: promo.code, credits: promo.credits, maxRedemptions: promo.maxRedemptions } };
  },
});

export const togglePromoAction = adminAction({
  name: "promo.toggle",
  revalidate: ["/admin/promo"],
  schema: z.object({ id: zUuid, active: z.enum(["0", "1"]) }),
  async run(input) {
    await setPromoActive(input.id, input.active === "1");
    return { message: input.active === "1" ? "Промокод включён" : "Промокод отключён", target: { type: "promo", id: input.id }, payload: { active: input.active === "1" } };
  },
});
