import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "../db/client";
import { referrals, users } from "../db/schema";
import { logger } from "../logger";
import { getSettings } from "../settings";
import { startOfUtcDay } from "../utils";
import { applyCreditChange } from "./credits";

/**
 * Rewards a pending referral when the invited user reaches the configured
 * milestone. Self-invites are impossible by construction (the referral is
 * created only for a different Telegram account); every reward is
 * unique per (referral, user) at the ledger level.
 */
export async function qualifyReferral(invitedUserId: string, milestone: "first_dream" | "first_purchase"): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.referral.enabled || settings.referral.trigger !== milestone) return false;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [ref] = await tx
        .select()
        .from(referrals)
        .where(and(eq(referrals.invitedId, invitedUserId), eq(referrals.status, "pending")))
        .for("update");
      if (!ref || ref.inviterId === invitedUserId) return false;
      const [inviter] = await tx.select().from(users).where(eq(users.id, ref.inviterId));
      if (!inviter || inviter.status !== "active") {
        await tx.update(referrals).set({ status: "blocked", blockedReason: "inviter_inactive" }).where(eq(referrals.id, ref.id));
        return false;
      }
      const [today] = await tx
        .select({ n: count() })
        .from(referrals)
        .where(and(eq(referrals.inviterId, ref.inviterId), eq(referrals.status, "rewarded"), gte(referrals.rewardedAt, startOfUtcDay())));
      if ((today?.n ?? 0) >= settings.referral.maxRewardsPerInviterPerDay) {
        await tx.update(referrals).set({ status: "qualified", qualifiedAt: new Date() }).where(eq(referrals.id, ref.id));
        return false;
      }
      const { rewardInviter, rewardInvited } = settings.referral;
      if (rewardInviter > 0) await applyCreditChange(tx, { userId: ref.inviterId, amount: rewardInviter, type: "referral_reward", referralId: ref.id, source: milestone });
      if (rewardInvited > 0) await applyCreditChange(tx, { userId: invitedUserId, amount: rewardInvited, type: "referral_reward", referralId: ref.id, source: milestone });
      await tx
        .update(referrals)
        .set({ status: "rewarded", qualifiedAt: ref.qualifiedAt ?? new Date(), rewardedAt: new Date(), rewardInviter, rewardInvited })
        .where(eq(referrals.id, ref.id));
      return true;
    });
  } catch (err) {
    logger.warn("referral qualification failed", { error: (err as Error).message, invitedUserId });
    return false;
  }
}

/** Admin: block a suspicious referral. Pending rewards are never paid; paid rewards are revoked as far as the balance allows. */
export async function blockReferral(referralId: string, reason: string, adminTelegramId: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [ref] = await tx.select().from(referrals).where(eq(referrals.id, referralId)).for("update");
    if (!ref || ref.status === "blocked") return;
    if (ref.status === "rewarded") {
      for (const [userId, amount] of [
        [ref.inviterId, ref.rewardInviter],
        [ref.invitedId, ref.rewardInvited],
      ] as const) {
        if (amount <= 0) continue;
        const [u] = await tx.select({ b: users.creditsBalance }).from(users).where(eq(users.id, userId)).for("update");
        const take = Math.min(amount, u?.b ?? 0);
        if (take > 0) await applyCreditChange(tx, { userId, amount: -take, type: "admin_revoke", adminTelegramId, note: `referral blocked: ${reason}` });
      }
    }
    await tx.update(referrals).set({ status: "blocked", blockedReason: reason.slice(0, 200) }).where(eq(referrals.id, ref.id));
  });
}
