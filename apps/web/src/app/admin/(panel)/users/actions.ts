"use server";

import { z } from "zod";
import { AppError } from "@dream/core/errors";
import { adjustUserCredits, setUserStatus } from "@dream/core/services/admin-ops";
import { blockReferral } from "@dream/core/services/referrals";
import { adminAction, zInt, zText, zUuid } from "@/server/admin/action";

export const adjustCreditsAction = adminAction({
  name: "user.credits.adjust",
  schema: z.object({
    userId: zUuid,
    direction: z.enum(["grant", "revoke"]),
    amount: zInt(1, 1_000_000),
    reason: zText(300, 3),
  }),
  async run(input, admin) {
    const amount = input.direction === "grant" ? input.amount : -input.amount;
    const { balance } = await adjustUserCredits(admin.telegramId, input.userId, amount, input.reason);
    return {
      message: `${amount > 0 ? "Начислено" : "Списано"} ${Math.abs(amount)} кр. Новый баланс: ${balance} кр.`,
      target: { type: "user", id: input.userId },
      payload: { amount, reason: input.reason, balance },
      revalidate: [`/admin/users/${input.userId}`],
    };
  },
});

export const setUserStatusAction = adminAction({
  name: "user.status.set",
  schema: z.object({
    userId: zUuid,
    status: z.enum(["active", "restricted", "banned"]),
    reason: z.string().trim().max(300).optional(),
  }),
  async run(input) {
    if (input.status !== "active" && (!input.reason || input.reason.length < 3)) {
      throw new AppError("validation_failed", "Укажите причину ограничения (минимум 3 символа)");
    }
    await setUserStatus(input.userId, input.status, input.reason ?? null);
    const label = { active: "Доступ восстановлен", restricted: "Доступ ограничен", banned: "Пользователь заблокирован" }[input.status];
    return { message: label, target: { type: "user", id: input.userId }, payload: { status: input.status, reason: input.reason ?? null }, revalidate: [`/admin/users/${input.userId}`, "/admin/users"] };
  },
});

export const blockReferralFromUserAction = adminAction({
  name: "referral.block",
  schema: z.object({ referralId: zUuid, userId: zUuid, reason: zText(200, 3) }),
  async run(input, admin) {
    await blockReferral(input.referralId, input.reason, admin.telegramId);
    return { message: "Реферал заблокирован", target: { type: "referral", id: input.referralId }, payload: { reason: input.reason }, revalidate: [`/admin/users/${input.userId}`, "/admin/referrals"] };
  },
});
