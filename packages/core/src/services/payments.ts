import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { payments, pricingPlans, users } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { JobOptions } from "../db/types";
import type { InvoiceDto, PaymentDto, StartGenerationBody } from "../dto";
import { AppError } from "../errors";
import { logger } from "../logger";
import { botApi } from "../telegram/bot-api";
import { GrammyError } from "grammy";
import { track } from "./analytics";
import { applyCreditChange } from "./credits";
import { startGeneration } from "./generation";
import { getProduct } from "./pricing";
import { qualifyReferral } from "./referrals";
import { assertActive, getUser, userLocale, type UserRow } from "./users";

/**
 * Telegram Stars (XTR) payments for digital goods.
 *  1. createInvoice → pending payment row + createInvoiceLink (payload = payment id)
 *  2. pre_checkout_query → validatePreCheckout (must answer within 10 s)
 *  3. successful_payment → handleSuccessfulPayment (idempotent, the only place credits are granted)
 * The server-side confirmed payment is the single source of truth.
 */

export interface GenerationIntent {
  dreamId: string;
  body: StartGenerationBody;
}

export async function createInvoice(user: UserRow, productId: string, intent?: GenerationIntent): Promise<InvoiceDto> {
  assertActive(user);
  const product = await getProduct(productId);
  if (!product) throw new AppError("not_found", "Product not found");
  const locale = userLocale(user);
  const id = randomUUID();
  await getDb()
    .insert(payments)
    .values({
      id,
      userId: user.id,
      telegramUserId: user.telegramId,
      productId: product.id,
      starsAmount: product.starsPrice,
      creditsAmount: product.credits,
      invoicePayload: id,
      intent: intent
        ? {
            dreamId: intent.dreamId,
            mediaType: intent.body.format,
            idempotencyKey: intent.body.idempotencyKey,
            options: { styleId: intent.body.styleId, targetDurationSec: intent.body.targetDurationSec, musicTrackId: intent.body.musicTrackId ?? null, watermark: true, action: "", locale } satisfies JobOptions,
          }
        : null,
    });
  const title = (locale === "en" ? product.titleEn : product.titleRu).slice(0, 32);
  const description = ((locale === "en" ? product.descriptionEn : product.descriptionRu) || title).slice(0, 255);
  // Stars: provider_token must be empty, currency XTR.
  const invoiceUrl = await botApi().createInvoiceLink(title, description, id, "", "XTR", [{ label: title, amount: product.starsPrice }]);
  await track("checkout_started", user.id, { product: product.id, stars: product.starsPrice, withIntent: Boolean(intent) });
  return { paymentId: id, invoiceUrl };
}

export async function validatePreCheckout(q: { fromId: number; payload: string; currency: string; totalAmount: number }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const [p] = await db.select().from(payments).where(eq(payments.invoicePayload, q.payload));
  if (!p) return { ok: false, reason: "unknown_invoice" };
  if (p.status !== "pending") return { ok: false, reason: "already_processed" };
  if (p.telegramUserId !== q.fromId) return { ok: false, reason: "wrong_user" };
  if (q.currency !== "XTR" || q.totalAmount !== p.starsAmount) return { ok: false, reason: "amount_mismatch" };
  if (p.productId) {
    const [prod] = await db.select({ active: pricingPlans.isActive }).from(pricingPlans).where(eq(pricingPlans.id, p.productId));
    if (!prod?.active) return { ok: false, reason: "product_unavailable" };
  }
  // The account behind the invoice must still exist (deleted accounts' payment rows keep user_id = null).
  if (!p.userId) return { ok: false, reason: "account_deleted" };
  const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, p.userId));
  if (!u || u.status !== "active") return { ok: false, reason: "account_restricted" };
  return { ok: true };
}

export interface SuccessfulPaymentInput {
  fromId: number;
  payload: string;
  currency: string;
  totalAmount: number;
  telegramPaymentChargeId: string;
  providerPaymentChargeId?: string;
}

export interface SuccessfulPaymentResult {
  status: "credited" | "duplicate" | "orphan";
  userId?: string;
  credits?: number;
  balance?: number;
  jobId?: string;
  dreamId?: string;
  locale?: "ru" | "en";
}

export async function handleSuccessfulPayment(input: SuccessfulPaymentInput): Promise<SuccessfulPaymentResult> {
  const db = getDb();
  let result: SuccessfulPaymentResult & { firstPurchase?: boolean; intent?: (typeof payments.$inferSelect)["intent"] };
  try {
    result = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.invoicePayload, input.payload)).for("update");
      if (!p) {
        // Money arrived for an invoice we don't know — record it for manual review, grant nothing automatically.
        await tx.insert(payments).values({
          telegramUserId: input.fromId,
          starsAmount: input.totalAmount,
          creditsAmount: 0,
          invoicePayload: `orphan:${input.telegramPaymentChargeId}`,
          telegramPaymentChargeId: input.telegramPaymentChargeId,
          providerPaymentChargeId: input.providerPaymentChargeId,
          status: "paid",
          paidAt: new Date(),
        });
        return { status: "orphan" as const };
      }
      if (p.status === "paid" || p.status === "refunded") return { status: "duplicate" as const, userId: p.userId ?? undefined };
      if (input.totalAmount !== p.starsAmount || input.currency !== "XTR") {
        logger.error("payment amount mismatch", { paymentId: p.id, expected: p.starsAmount, got: input.totalAmount });
      }
      await tx
        .update(payments)
        .set({ status: "paid", paidAt: new Date(), telegramPaymentChargeId: input.telegramPaymentChargeId, providerPaymentChargeId: input.providerPaymentChargeId })
        .where(eq(payments.id, p.id));
      if (!p.userId) return { status: "orphan" as const };
      const [before] = await tx.select({ hasPaid: users.hasPaid, language: users.language }).from(users).where(eq(users.id, p.userId)).for("update");
      const { balance } = await applyCreditChange(tx, { userId: p.userId, amount: p.creditsAmount, type: "purchase", paymentId: p.id, source: p.productId ?? "stars" });
      await tx
        .update(users)
        .set({ hasPaid: true, firstPurchaseAt: sql`coalesce(${users.firstPurchaseAt}, now())` })
        .where(eq(users.id, p.userId));
      const firstPurchase = before ? !before.hasPaid : false;
      return { status: "credited" as const, userId: p.userId, credits: p.creditsAmount, balance, firstPurchase, intent: p.intent, locale: before?.language === "en" ? ("en" as const) : ("ru" as const) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate" };
    throw err;
  }

  if (result.status !== "credited" || !result.userId) return result;
  await track("purchase_completed", result.userId, { stars: input.totalAmount, credits: result.credits ?? 0, first: Boolean(result.firstPurchase) });
  if (result.firstPurchase) await qualifyReferral(result.userId, "first_purchase");

  if (result.intent) {
    try {
      const user = await getUser(result.userId);
      const job = await startGeneration(user, result.intent.dreamId, {
        format: result.intent.mediaType,
        styleId: result.intent.options.styleId,
        targetDurationSec: result.intent.options.targetDurationSec,
        musicTrackId: result.intent.options.musicTrackId,
        idempotencyKey: result.intent.idempotencyKey,
        locale: result.locale ?? "ru",
      });
      result.jobId = job.id;
    } catch (err) {
      // Credits stay on the balance — the user can start the generation manually.
      logger.warn("post-payment generation failed to start", { error: (err as Error).message });
    }
  }
  return { status: result.status, userId: result.userId, credits: result.credits, balance: result.balance, jobId: result.jobId, dreamId: result.intent?.dreamId, locale: result.locale };
}

/** Admin refund through Bot API refundStarPayment. Credits are revoked as far as the balance allows. */
export async function refundPayment(paymentId: string, adminTelegramId: number, reason: string): Promise<{ revokedCredits: number }> {
  const db = getDb();
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || p.status !== "paid" || !p.telegramPaymentChargeId || !p.telegramUserId) throw new AppError("conflict", "Payment cannot be refunded");
  try {
    await botApi().refundStarPayment(p.telegramUserId, p.telegramPaymentChargeId);
  } catch (err) {
    // A previous attempt may have refunded at Telegram but failed before the DB update — finish it now.
    if (!(err instanceof GrammyError && /ALREADY_REFUNDED/i.test(err.description))) throw err;
    logger.warn("charge already refunded at Telegram, completing local refund", { paymentId });
  }
  const revoked = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!locked || locked.status !== "paid") return 0;
    let take = 0;
    if (locked.userId) {
      const [u] = await tx.select({ b: users.creditsBalance }).from(users).where(eq(users.id, locked.userId)).for("update");
      take = Math.min(locked.creditsAmount, u?.b ?? 0);
      if (take > 0) await applyCreditChange(tx, { userId: locked.userId, amount: -take, type: "refund_revoke", paymentId: locked.id, adminTelegramId, note: reason });
    }
    await tx.update(payments).set({ status: "refunded", refundedAt: new Date(), refundReason: reason.slice(0, 300) }).where(eq(payments.id, locked.id));
    return take;
  });
  if (p.userId) await track("payment_refunded", p.userId, { stars: p.starsAmount });
  return { revokedCredits: revoked };
}

export async function listUserPayments(userId: string, locale: "ru" | "en", limit = 50): Promise<PaymentDto[]> {
  const rows = await getDb()
    .select({ p: payments, titleRu: pricingPlans.titleRu, titleEn: pricingPlans.titleEn })
    .from(payments)
    .leftJoin(pricingPlans, eq(pricingPlans.id, payments.productId))
    .where(and(eq(payments.userId, userId)))
    .orderBy(desc(payments.createdAt))
    .limit(limit);
  return rows
    .filter((r) => r.p.status !== "pending" || Date.now() - r.p.createdAt.getTime() < 3600_000)
    .map((r) => ({
      id: r.p.id,
      productTitle: locale === "en" ? r.titleEn : r.titleRu,
      stars: r.p.starsAmount,
      credits: r.p.creditsAmount,
      status: r.p.status,
      createdAt: r.p.createdAt.toISOString(),
      paidAt: r.p.paidAt?.toISOString() ?? null,
    }));
}

export async function getPaymentStatus(user: UserRow, paymentId: string) {
  const [p] = await getDb()
    .select({ status: payments.status, intent: payments.intent })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.userId, user.id)));
  if (!p) throw new AppError("not_found", "Payment not found");
  return p;
}
