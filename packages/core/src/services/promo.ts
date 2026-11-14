import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { promoCodes, promoRedemptions } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import { hitRateLimit } from "../redis";
import { track } from "./analytics";
import { applyCreditChange } from "./credits";
import { assertActive, type UserRow } from "./users";

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

/** Redeems a one-time promo code. One redemption per user, capped by max_redemptions. */
export async function redeemPromo(user: UserRow, rawCode: string): Promise<{ credits: number; balance: number }> {
  assertActive(user);
  const rl = await hitRateLimit(`promo:${user.id}`, 10, 3600);
  if (!rl.allowed) throw new AppError("rate_limited", "Too many attempts");
  const code = normalizePromoCode(rawCode);
  if (!code) throw new AppError("promo_invalid", "Invalid code");
  try {
    const res = await getDb().transaction(async (tx) => {
      const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).for("update");
      if (!promo || !promo.isActive) throw new AppError("promo_invalid", "Invalid code");
      if (promo.expiresAt && promo.expiresAt < new Date()) throw new AppError("promo_invalid", "Code expired");
      if (promo.maxRedemptions !== null && promo.redemptionsCount >= promo.maxRedemptions) throw new AppError("promo_exhausted", "Code exhausted");
      if (promo.onlyNewUsers && (user.hasPaid || Date.now() - user.createdAt.getTime() > 7 * 86_400_000)) throw new AppError("promo_invalid", "Only for new users");
      const [redemption] = await tx.insert(promoRedemptions).values({ promoId: promo.id, userId: user.id, credits: promo.credits }).returning();
      await tx
        .update(promoCodes)
        .set({ redemptionsCount: sql`${promoCodes.redemptionsCount} + 1` })
        .where(eq(promoCodes.id, promo.id));
      const { balance } = await applyCreditChange(tx, { userId: user.id, amount: promo.credits, type: "promo", promoRedemptionId: redemption!.id, source: code });
      return { credits: promo.credits, balance };
    });
    await track("promo_redeemed", user.id, { credits: res.credits });
    return res;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("promo_already_used", "Code already used");
    throw err;
  }
}
