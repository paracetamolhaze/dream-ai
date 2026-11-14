"use server";

import { z } from "zod";
import { createCampaign, updateCampaign } from "@dream/core/services/admin-ops";
import { adminAction, zOptText, zText, zUuid } from "@/server/admin/action";

const campaignType = z.enum(["channel", "blogger", "ads", "partner", "other"]);

export const createCampaignAction = adminAction({
  name: "campaign.create",
  revalidate: ["/admin/campaigns"],
  schema: z.object({
    code: zText(40, 2),
    name: zText(120, 2),
    type: campaignType,
    notes: zOptText(500),
    partnerUserId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.string().uuid().nullable()),
  }),
  async run(input) {
    const c = await createCampaign(input);
    return { message: `Кампания ${c.code} создана`, target: { type: "campaign", id: c.id }, payload: { code: c.code, type: c.type } };
  },
});

export const updateCampaignAction = adminAction({
  name: "campaign.update",
  revalidate: ["/admin/campaigns"],
  schema: z.object({ id: zUuid, name: zText(120, 2), type: campaignType, notes: zOptText(500) }),
  async run(input) {
    await updateCampaign(input.id, { name: input.name, type: input.type, notes: input.notes });
    return { message: "Кампания сохранена", target: { type: "campaign", id: input.id }, payload: input };
  },
});

export const toggleCampaignAction = adminAction({
  name: "campaign.toggle",
  revalidate: ["/admin/campaigns"],
  schema: z.object({ id: zUuid, active: z.enum(["0", "1"]) }),
  async run(input) {
    await updateCampaign(input.id, { isActive: input.active === "1" });
    return { message: input.active === "1" ? "Кампания включена" : "Кампания отключена — новые переходы не будут атрибутированы", target: { type: "campaign", id: input.id }, payload: { active: input.active === "1" } };
  },
});
