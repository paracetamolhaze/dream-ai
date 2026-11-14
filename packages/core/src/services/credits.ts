import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "../db/client";
import { ACTIVE_JOB_STATUSES, creditTransactions, generationJobs, users } from "../db/schema";
import { AppError } from "../errors";

type TxType = (typeof creditTransactions.$inferInsert)["type"];

export interface CreditChange {
  userId: string;
  /** Signed change of the available balance. */
  amount: number;
  /** Signed change of the reserved (held) amount. */
  reservedDelta?: number;
  type: TxType;
  source?: string;
  jobId?: string;
  paymentId?: string;
  referralId?: string;
  promoRedemptionId?: string;
  adminTelegramId?: number;
  note?: string;
}

/**
 * Applies a balance change atomically and writes the ledger entry.
 * The conditional UPDATE guarantees the balance never goes negative even under
 * concurrent requests; the ledger's unique indexes reject double application.
 * Callers that move credits for a job/payment must hold that row's lock.
 */
export async function applyCreditChange(tx: Tx, c: CreditChange): Promise<{ balance: number; reserved: number }> {
  const reservedDelta = c.reservedDelta ?? 0;
  const updated = await tx
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} + ${c.amount}`,
      creditsReserved: sql`${users.creditsReserved} + ${reservedDelta}`,
    })
    .where(and(eq(users.id, c.userId), sql`${users.creditsBalance} + ${c.amount} >= 0`, sql`${users.creditsReserved} + ${reservedDelta} >= 0`))
    .returning({ balance: users.creditsBalance, reserved: users.creditsReserved });
  const row = updated[0];
  if (!row) {
    throw new AppError("insufficient_credits", "Not enough credits", { details: { required: -c.amount } });
  }
  await tx.insert(creditTransactions).values({
    userId: c.userId,
    amount: c.amount,
    balanceAfter: row.balance,
    type: c.type,
    source: c.source,
    jobId: c.jobId,
    paymentId: c.paymentId,
    referralId: c.referralId,
    promoRedemptionId: c.promoRedemptionId,
    adminTelegramId: c.adminTelegramId,
    note: c.note,
  });
  return row;
}

/** Final charge: the reserved credits of a completed job are consumed. Idempotent. */
export async function captureJobCredits(jobId: string, db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.id, jobId)).for("update");
    if (!job || job.creditState !== "reserved") return;
    if (job.creditsCost > 0) {
      await applyCreditChange(tx, { userId: job.userId, amount: 0, reservedDelta: -job.creditsCost, type: "capture", jobId, source: "generation" });
    }
    await tx.update(generationJobs).set({ creditState: "captured" }).where(eq(generationJobs.id, jobId));
  });
}

/**
 * Returns reserved credits (and the free allowance) of a job that finally
 * failed or was cancelled. Idempotent — a job can be released only once.
 */
export async function releaseJobCredits(jobId: string, reason: string, db = getDb()): Promise<{ released: number; freeReturned: boolean }> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.id, jobId)).for("update");
    if (!job || job.creditState !== "reserved") return { released: 0, freeReturned: false };
    if (job.creditsCost > 0) {
      await applyCreditChange(tx, { userId: job.userId, amount: job.creditsCost, reservedDelta: -job.creditsCost, type: "release", jobId, source: "generation", note: reason });
    }
    if (job.usedFreeAllowance) {
      await tx
        .update(users)
        .set({ freeSlideshowsUsed: sql`greatest(${users.freeSlideshowsUsed} - 1, 0)` })
        .where(eq(users.id, job.userId));
    }
    await tx.update(generationJobs).set({ creditState: "released" }).where(eq(generationJobs.id, jobId));
    return { released: job.creditsCost, freeReturned: job.usedFreeAllowance };
  });
}

/**
 * Cancels an active job and returns its reservation (and free allowance) in a
 * single transaction. Returns null if the job is not active (already finished).
 */
export async function cancelJobAndRelease(jobId: string, reason: string, opts: { userId?: string } = {}, db = getDb()) {
  return finishJobAndRelease(jobId, { status: "cancelled", errorCode: reason, userId: opts.userId }, db);
}

/**
 * Ends an active job as cancelled/failed and returns its reservation (and free
 * allowance) in the same transaction — so a concurrent completion can never
 * end up "completed" with credits already returned, or vice versa.
 */
export async function finishJobAndRelease(
  jobId: string,
  opts: { status: "cancelled" | "failed"; errorCode: string; errorMessage?: string; userId?: string },
  db = getDb(),
) {
  const reason = opts.errorCode;
  return db.transaction(async (tx) => {
    const conds = [eq(generationJobs.id, jobId)];
    if (opts.userId) conds.push(eq(generationJobs.userId, opts.userId));
    const [job] = await tx
      .select()
      .from(generationJobs)
      .where(and(...conds))
      .for("update");
    if (!job || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)) return null;
    if (job.creditState === "reserved") {
      if (job.creditsCost > 0) {
        await applyCreditChange(tx, { userId: job.userId, amount: job.creditsCost, reservedDelta: -job.creditsCost, type: "release", jobId: job.id, source: "generation", note: reason });
      }
      if (job.usedFreeAllowance) {
        await tx
          .update(users)
          .set({ freeSlideshowsUsed: sql`greatest(${users.freeSlideshowsUsed} - 1, 0)` })
          .where(eq(users.id, job.userId));
      }
    }
    const [updated] = await tx
      .update(generationJobs)
      .set({
        status: opts.status,
        currentStage: opts.status,
        finishedAt: new Date(),
        errorCode: reason,
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage.slice(0, 1000) } : {}),
        creditState: job.creditState === "reserved" ? "released" : job.creditState,
      })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return updated ? { ...updated, releasedCredits: job.creditState === "reserved" ? job.creditsCost : 0, freeReturned: job.creditState === "reserved" && job.usedFreeAllowance } : null;
  });
}

export async function grantCredits(c: Omit<CreditChange, "reservedDelta"> & { amount: number }, db = getDb()): Promise<{ balance: number }> {
  if (c.amount === 0) {
    const [u] = await db.select({ balance: users.creditsBalance }).from(users).where(eq(users.id, c.userId));
    return { balance: u?.balance ?? 0 };
  }
  return db.transaction(async (tx) => applyCreditChange(tx, c));
}

export async function getBalance(userId: string, db: DbOrTx = getDb()) {
  const [u] = await db.select({ balance: users.creditsBalance, reserved: users.creditsReserved, freeUsed: users.freeSlideshowsUsed }).from(users).where(eq(users.id, userId));
  return u ?? { balance: 0, reserved: 0, freeUsed: 0 };
}

export async function listCreditTransactions(userId: string, limit = 50, db: DbOrTx = getDb()) {
  return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt)).limit(limit);
}
