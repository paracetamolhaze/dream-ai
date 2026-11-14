"use server";

import { z } from "zod";
import { blockReferral } from "@dream/core/services/referrals";
import { adminAction, zText, zUuid } from "@/server/admin/action";

export const blockReferralAction = adminAction({
  name: "referral.block",
  revalidate: ["/admin/referrals"],
  schema: z.object({ referralId: zUuid, reason: zText(200, 3) }),
  async run(input, admin) {
    await blockReferral(input.referralId, input.reason, admin.telegramId);
    return { message: "Реферал заблокирован, награды отозваны в пределах баланса", target: { type: "referral", id: input.referralId }, payload: { reason: input.reason } };
  },
});
