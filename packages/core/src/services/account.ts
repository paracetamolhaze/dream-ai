import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { ACTIVE_JOB_STATUSES, deletedAccountMarkers, dreams, generationJobs, payments, supportTickets, users } from "../db/schema";
import { mediaSigningSecret } from "../env";
import { hmacSha256 } from "../utils";
import { logger } from "../logger";
import { enqueue, jobIdFor, QUEUES } from "../queue";
import { getSettings } from "../settings";
import { deleteObjects, deletePrefix, keys } from "../storage";
import { track } from "./analytics";
import type { UserRow } from "./users";

/**
 * Account deletion: the account is restricted immediately (no further API
 * access), active jobs are cancelled, then the worker removes every stored
 * file under the user's prefix and hard-deletes the user row. Dreams, scenes,
 * media, settings, ledger and share links cascade. Payment rows are kept
 * without the user link because Stars refunds and accounting need them.
 */
export async function requestAccountDeletion(user: UserRow): Promise<void> {
  const db = getDb();
  await db.update(users).set({ status: "deleted", deletedAt: new Date() }).where(eq(users.id, user.id));
  await db
    .update(generationJobs)
    .set({ status: "cancelled", finishedAt: new Date(), errorCode: "account_deleted" })
    .where(and(eq(generationJobs.userId, user.id), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])));
  await enqueue(QUEUES.system, { type: "delete_account", userId: user.id, telegramId: user.telegramId }, { jobId: jobIdFor("delacc", user.id), attempts: 10 });
  await track("account_deleted", null, {});
}

/** Worker side of account deletion. Safe to run repeatedly. */
/** Keyed hash of a Telegram id for the anti-abuse marker (no raw id is stored). */
export function telegramIdMarker(telegramId: number): string {
  return hmacSha256(mediaSigningSecret(), `deleted-account:${telegramId}`).toString("hex");
}

export async function purgeAccount(userId: string, telegramId?: number): Promise<{ files: number }> {
  const files = await deletePrefix(keys.userPrefix(userId));
  const db = getDb();
  const [u] = await db.select({ telegramId: users.telegramId, freeUsed: users.freeSlideshowsUsed }).from(users).where(eq(users.id, userId));
  const tgId = telegramId ?? u?.telegramId;
  if (tgId) {
    await db
      .insert(deletedAccountMarkers)
      .values({ telegramIdHash: telegramIdMarker(tgId), freeSlideshowsUsed: u?.freeUsed ?? 0 })
      .onConflictDoUpdate({ target: deletedAccountMarkers.telegramIdHash, set: { freeSlideshowsUsed: sql`greatest(${deletedAccountMarkers.freeSlideshowsUsed}, ${u?.freeUsed ?? 0})`, deletedAt: new Date() } });
  }
  // Support messages are personal data too — remove them with the account.
  await db.delete(supportTickets).where(tgId ? or(eq(supportTickets.userId, userId), eq(supportTickets.telegramUserId, tgId)) : eq(supportTickets.userId, userId));
  // Unpaid invoices of the account must not be payable afterwards.
  await db.update(payments).set({ status: "expired" }).where(and(eq(payments.userId, userId), eq(payments.status, "pending")));
  await db.delete(users).where(eq(users.id, userId));
  logger.info("account purged", { userId, files });
  return { files };
}

/** Worker side of dream deletion: removes files and rows. */
export async function purgeDream(userId: string, dreamId: string): Promise<{ files: number }> {
  const files = await deletePrefix(keys.dreamPrefix(userId, dreamId));
  await getDb().delete(dreams).where(and(eq(dreams.id, dreamId), eq(dreams.userId, userId), isNotNull(dreams.deletedAt)));
  return { files };
}

/** Applies the audio retention policy (global default or per-user override). */
export async function applyAudioRetention(): Promise<number> {
  const { retention } = await getSettings();
  if (retention.audioRetentionDays < 0) return 0;
  const cutoff = new Date(Date.now() - retention.audioRetentionDays * 86_400_000);
  const db = getDb();
  const rows = await db
    .select({ id: dreams.id, key: dreams.originalAudioKey })
    .from(dreams)
    .where(
      and(
        isNotNull(dreams.originalAudioKey),
        isNull(dreams.audioDeletedAt),
        // Measured from the last change (a re-record restarts the clock).
        lt(dreams.updatedAt, cutoff),
        or(
          inArray(dreams.status, ["review", "ready", "analysis_failed", "transcription_failed", "draft"]),
          // A transcription stuck for more than a day is not going to finish.
          and(eq(dreams.status, "transcribing"), lt(dreams.updatedAt, new Date(Math.min(cutoff.getTime(), Date.now() - 86_400_000)))),
        ),
      ),
    )
    .limit(500);
  if (rows.length === 0) return 0;
  await deleteObjects(rows.map((r) => r.key!));
  await db
    .update(dreams)
    .set({ audioDeletedAt: new Date() })
    .where(inArray(dreams.id, rows.map((r) => r.id)));
  return rows.length;
}

/** User action: delete all stored voice recordings now. */
export async function deleteAllAudio(user: UserRow): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: dreams.id, key: dreams.originalAudioKey })
    .from(dreams)
    .where(and(eq(dreams.userId, user.id), isNotNull(dreams.originalAudioKey), isNull(dreams.audioDeletedAt), ne(dreams.status, "transcribing")));
  const deletable = rows.filter((r) => r.key);
  if (deletable.length === 0) return 0;
  await deleteObjects(deletable.map((r) => r.key!));
  await db
    .update(dreams)
    .set({ audioDeletedAt: new Date() })
    .where(inArray(dreams.id, deletable.map((r) => r.id)));
  return deletable.length;
}
