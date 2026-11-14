import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { creditTransactions, payments, referrals } from "../src/db/schema";
import { closeQueues } from "../src/queue";
import { closeRedis } from "../src/redis";
import { handleSuccessfulPayment, validatePreCheckout } from "../src/services/payments";
import { upsertTelegramUser } from "../src/services/users";
import { updateSettings } from "../src/settings";
import { createUser, getUserRow, integration, uniqueTelegramId } from "./helpers";

async function pendingPayment(userId: string, telegramUserId: number, stars = 99, credits = 50) {
  const id = randomUUID();
  await getDb().insert(payments).values({ id, userId, telegramUserId, productId: "pack_small", starsAmount: stars, creditsAmount: credits, invoicePayload: id });
  return id;
}

describe.skipIf(!integration)("Telegram Stars payments", () => {
  afterAll(async () => {
    await closeQueues();
    await closeRedis();
    await closeDb();
  });

  it("validates pre_checkout against the stored invoice", async () => {
    const u = await createUser();
    const id = await pendingPayment(u.id, u.telegramId);
    expect(await validatePreCheckout({ fromId: u.telegramId, payload: id, currency: "XTR", totalAmount: 99 })).toEqual({ ok: true });
    expect(await validatePreCheckout({ fromId: u.telegramId, payload: id, currency: "XTR", totalAmount: 1 })).toMatchObject({ ok: false });
    expect(await validatePreCheckout({ fromId: 1, payload: id, currency: "XTR", totalAmount: 99 })).toMatchObject({ ok: false, reason: "wrong_user" });
    expect(await validatePreCheckout({ fromId: u.telegramId, payload: randomUUID(), currency: "XTR", totalAmount: 99 })).toMatchObject({ ok: false });
  });

  it("credits a successful payment exactly once, even for duplicate concurrent updates", async () => {
    const u = await createUser();
    const id = await pendingPayment(u.id, u.telegramId);
    const input = { fromId: u.telegramId, payload: id, currency: "XTR", totalAmount: 99, telegramPaymentChargeId: `charge-${id}` };
    const results = await Promise.all([handleSuccessfulPayment(input), handleSuccessfulPayment(input), handleSuccessfulPayment(input)]);
    expect(results.filter((r) => r.status === "credited")).toHaveLength(1);
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(50);
    expect(after.hasPaid).toBe(true);
    const tx = await getDb().select().from(creditTransactions).where(eq(creditTransactions.paymentId, id));
    expect(tx).toHaveLength(1);
    const [p] = await getDb().select().from(payments).where(eq(payments.id, id));
    expect(p!.status).toBe("paid");
    // A later redelivery is a no-op too.
    expect((await handleSuccessfulPayment(input)).status).toBe("duplicate");
  });

  it("does not grant credits for unknown invoices (recorded for review)", async () => {
    const res = await handleSuccessfulPayment({ fromId: 1, payload: randomUUID(), currency: "XTR", totalAmount: 10, telegramPaymentChargeId: `orphan-${randomUUID()}` });
    expect(res.status).toBe("orphan");
  });

  it("rewards a referral once on the first purchase and never for self-invites", async () => {
    await updateSettings("referral", { enabled: true, rewardInviter: 10, rewardInvited: 5, trigger: "first_purchase", maxRewardsPerInviterPerDay: 20 });
    const inviter = await createUser();
    const tg = uniqueTelegramId();
    const { user: invited } = await upsertTelegramUser({ id: tg, first_name: "Friend" }, { startParam: `ref_${inviter.referralCode}` });
    expect(invited.referredBy).toBe(inviter.id);
    // Inviter opening their own link must not create a referral.
    await upsertTelegramUser({ id: inviter.telegramId, first_name: "Self" }, { startParam: `ref_${inviter.referralCode}` });
    const refs = await getDb().select().from(referrals).where(eq(referrals.inviterId, inviter.id));
    expect(refs).toHaveLength(1);

    const p1 = await pendingPayment(invited.id, tg);
    await handleSuccessfulPayment({ fromId: tg, payload: p1, currency: "XTR", totalAmount: 99, telegramPaymentChargeId: `c1-${p1}` });
    const p2 = await pendingPayment(invited.id, tg);
    await handleSuccessfulPayment({ fromId: tg, payload: p2, currency: "XTR", totalAmount: 99, telegramPaymentChargeId: `c2-${p2}` });
    expect((await getUserRow(inviter.id)).creditsBalance).toBe(10);
    expect((await getUserRow(invited.id)).creditsBalance).toBe(50 + 50 + 5);
    const [ref] = await getDb().select().from(referrals).where(eq(referrals.invitedId, invited.id));
    expect(ref!.status).toBe("rewarded");
  });
});
