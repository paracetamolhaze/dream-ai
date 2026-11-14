import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { env } from "../env";
import { getDb } from "../db/client";
import { adminUsers, campaigns, channelPosts, dreamMedia, dreams, generationJobs, musicTracks, pricingPlans, promoCodes, supportTickets, users, visualStyles } from "../db/schema";
import { isUniqueViolation, pgConstraint } from "../db/errors";
import { AppError } from "../errors";
import { enqueue, QUEUES } from "../queue";
import { getSettings, updateSettings } from "../settings";
import { deleteObjects, keys, putObject } from "../storage";
import { findImageModel } from "../ai/models";
import { effectiveVideoSpec, isDemoSelection } from "../ai/registry";
import { grantCredits } from "./credits";
import { detectAudioFormat } from "./dreams";
import { normalizePromoCode } from "./promo";
import { isAdminTelegramId } from "./users";

/**
 * Admin-only mutations. Authorization (session + allow-list + role) and the
 * audit log entry are the responsibility of the calling server action; these
 * functions validate business rules and keep the ledger consistent.
 */

export type AdminRole = "owner" | "admin" | "support";
export const ADMIN_ROLES: AdminRole[] = ["owner", "admin", "support"];
const ROLE_RANK: Record<AdminRole, number> = { support: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: AdminRole, min: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function envOwnerIds(): number[] {
  return env()
    .ADMIN_TELEGRAM_IDS.map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

/** Role of an admin, or null if the Telegram id is not an admin. Env allow-list = owner. */
export async function getAdminRole(telegramId: number): Promise<AdminRole | null> {
  if (!(await isAdminTelegramId(telegramId))) return null;
  if (envOwnerIds().includes(telegramId)) return "owner";
  const [row] = await getDb().select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.telegramId, telegramId));
  return row?.role ?? null;
}

// ─── Users ──────────────────────────────────────────────────────────────────

export async function adjustUserCredits(adminTelegramId: number, userId: string, amount: number, reason: string) {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) throw new AppError("validation_failed", "Amount must be a non-zero integer");
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("not_found", "User not found");
  return grantCredits({
    userId,
    amount,
    type: amount > 0 ? "admin_grant" : "admin_revoke",
    adminTelegramId,
    source: "admin",
    note: reason.slice(0, 300),
  });
}

export async function setUserStatus(userId: string, status: "active" | "restricted" | "banned", reason: string | null) {
  const [u] = await getDb()
    .update(users)
    .set({ status, restrictedReason: status === "active" ? null : (reason ?? "").slice(0, 300) || null })
    .where(and(eq(users.id, userId), inArray(users.status, ["active", "restricted", "banned"])))
    .returning({ id: users.id });
  if (!u) throw new AppError("not_found", "User not found or deleted");
}

// ─── Generations ────────────────────────────────────────────────────────────

/**
 * Retries a failed/cancelled generation as a new job, free of charge for the
 * user (the original reservation was already released). Uses the currently
 * configured models, so a provider switch in the admin panel takes effect.
 */
export async function adminRetryJob(adminTelegramId: number, jobId: string): Promise<{ jobId: string }> {
  const db = getDb();
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) throw new AppError("not_found", "Job not found");
  if (job.status !== "failed" && job.status !== "cancelled") throw new AppError("conflict", "Only failed or cancelled jobs can be retried");
  const [dream] = await db.select({ id: dreams.id, status: dreams.status, deletedAt: dreams.deletedAt }).from(dreams).where(eq(dreams.id, job.dreamId));
  if (!dream || dream.deletedAt) throw new AppError("conflict", "Dream was deleted");
  if (dream.status !== "ready") throw new AppError("dream_not_ready", "Dream analysis is not ready");
  const [owner] = await db.select({ status: users.status }).from(users).where(eq(users.id, job.userId));
  if (!owner || owner.status !== "active") throw new AppError("account_restricted", "User is not active");

  const settings = await getSettings({ fresh: true });
  const demo = isDemoSelection(settings);
  let created: typeof generationJobs.$inferSelect;
  try {
    [created] = (await db
      .insert(generationJobs)
      .values({
        userId: job.userId,
        dreamId: job.dreamId,
        mediaType: job.mediaType,
        kind: job.kind,
        sceneId: job.sceneId,
        status: "queued",
        currentStage: "queued",
        options: job.options,
        provider: findImageModel(settings.models.image.model)?.provider,
        model: settings.models.image.model,
        videoProvider: job.mediaType === "video" ? effectiveVideoSpec(settings).provider : null,
        videoModel: job.mediaType === "video" ? settings.models.video.model : null,
        idempotencyKey: `admin-retry-${job.id}-${Date.now()}`,
        creditsCost: 0,
        creditState: "none",
        usedFreeAllowance: false,
        estimatedCostUsd: job.estimatedCostUsd,
        isDemo: demo.image || (job.mediaType === "video" && demo.video),
      })
      .returning()) as [typeof generationJobs.$inferSelect];
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("job_already_running", `A generation is already running (${pgConstraint(err) ?? "unique"})`);
    throw err;
  }
  try {
    await enqueue(job.mediaType === "video" ? QUEUES.video : QUEUES.slideshow, { jobId: created.id }, { jobId: created.id, attempts: settings.generation.maxAttempts });
  } catch (err) {
    await db.update(generationJobs).set({ status: "failed", errorCode: "internal", errorMessage: "enqueue failed (admin retry)", finishedAt: new Date() }).where(eq(generationJobs.id, created.id));
    throw err;
  }
  void adminTelegramId;
  return { jobId: created.id };
}

// ─── Promo codes ────────────────────────────────────────────────────────────

export async function createPromo(input: { code: string; credits: number; maxRedemptions: number | null; expiresAt: Date | null; onlyNewUsers: boolean; note: string | null }, adminTelegramId: number) {
  const code = normalizePromoCode(input.code);
  if (code.length < 3) throw new AppError("validation_failed", "Code must be at least 3 characters (A-Z, 0-9, _ -)");
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 100_000) throw new AppError("validation_failed", "Credits must be 1..100000");
  try {
    const [row] = await getDb()
      .insert(promoCodes)
      .values({ code, credits: input.credits, maxRedemptions: input.maxRedemptions, expiresAt: input.expiresAt, onlyNewUsers: input.onlyNewUsers, note: input.note, createdBy: adminTelegramId })
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "Promo code already exists");
    throw err;
  }
}

export async function setPromoActive(id: string, active: boolean) {
  const res = await getDb().update(promoCodes).set({ isActive: active }).where(eq(promoCodes.id, id)).returning({ id: promoCodes.id });
  if (res.length === 0) throw new AppError("not_found", "Promo code not found");
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export function normalizeCampaignCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

type CampaignType = (typeof campaigns.$inferInsert)["type"];

export async function createCampaign(input: { code: string; name: string; type: CampaignType; notes: string | null; partnerUserId: string | null }) {
  const code = normalizeCampaignCode(input.code);
  if (code.length < 2) throw new AppError("validation_failed", "Code must be at least 2 characters (a-z, 0-9, _ -)");
  if (input.partnerUserId) {
    const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, input.partnerUserId));
    if (!u) throw new AppError("not_found", "Partner user not found");
  }
  try {
    const [row] = await getDb()
      .insert(campaigns)
      .values({ code, name: input.name.slice(0, 120), type: input.type, notes: input.notes, partnerUserId: input.partnerUserId })
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "Campaign code already exists");
    throw err;
  }
}

export async function updateCampaign(id: string, patch: { name?: string; type?: CampaignType; notes?: string | null; isActive?: boolean }) {
  const res = await getDb().update(campaigns).set(patch).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
  if (res.length === 0) throw new AppError("not_found", "Campaign not found");
}

/** Creates the campaign if it doesn't exist (used for the default "channel" source). */
export async function ensureCampaign(code: string, name: string, type: CampaignType) {
  const c = normalizeCampaignCode(code);
  const db = getDb();
  await db.insert(campaigns).values({ code: c, name, type }).onConflictDoNothing();
  const [row] = await db.select().from(campaigns).where(eq(campaigns.code, c));
  return row!;
}

// ─── Visual styles ──────────────────────────────────────────────────────────

export interface StyleInput {
  id: string;
  nameRu: string;
  nameEn: string;
  promptPrefix: string;
  promptSuffix: string;
  negativePrompt: string;
  swatch: string;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertStyle(input: StyleInput) {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(id)) throw new AppError("validation_failed", "Style id: 2-32 chars a-z, 0-9, _");
  if (!/^(linear|radial|conic)-gradient\([^;{}<>]{3,300}\)$|^#[0-9a-f]{3,8}$/i.test(input.swatch.trim())) {
    throw new AppError("validation_failed", "Swatch must be a CSS gradient or hex color");
  }
  const values = { ...input, id, swatch: input.swatch.trim() };
  await getDb()
    .insert(visualStyles)
    .values(values)
    .onConflictDoUpdate({
      target: visualStyles.id,
      set: {
        nameRu: values.nameRu,
        nameEn: values.nameEn,
        promptPrefix: values.promptPrefix,
        promptSuffix: values.promptSuffix,
        negativePrompt: values.negativePrompt,
        swatch: values.swatch,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
        updatedAt: new Date(),
      },
    });
}

export async function setStyleActive(id: string, active: boolean) {
  if (!active) {
    const rows = await getDb().select({ id: visualStyles.id }).from(visualStyles).where(eq(visualStyles.isActive, true));
    if (rows.length <= 1 && rows[0]?.id === id) throw new AppError("conflict", "At least one style must stay active");
  }
  await getDb().update(visualStyles).set({ isActive: active }).where(eq(visualStyles.id, id));
}

// ─── Products (Stars) ───────────────────────────────────────────────────────

type ProductKind = (typeof pricingPlans.$inferInsert)["kind"];

export interface ProductInput {
  id: string;
  kind: ProductKind;
  titleRu: string;
  titleEn: string;
  descriptionRu: string;
  descriptionEn: string;
  starsPrice: number;
  credits: number;
  badge: string | null;
  removesWatermark: boolean;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertProduct(input: ProductInput) {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(id)) throw new AppError("validation_failed", "Product id: 2-40 chars a-z, 0-9, _");
  if (!Number.isInteger(input.starsPrice) || input.starsPrice < 1 || input.starsPrice > 100_000) throw new AppError("validation_failed", "Stars price must be 1..100000");
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 1_000_000) throw new AppError("validation_failed", "Credits must be ≥ 1");
  const values = { ...input, id, titleRu: input.titleRu.slice(0, 32), titleEn: input.titleEn.slice(0, 32) };
  await getDb()
    .insert(pricingPlans)
    .values(values)
    .onConflictDoUpdate({
      target: pricingPlans.id,
      set: {
        kind: values.kind,
        titleRu: values.titleRu,
        titleEn: values.titleEn,
        descriptionRu: values.descriptionRu,
        descriptionEn: values.descriptionEn,
        starsPrice: values.starsPrice,
        credits: values.credits,
        badge: values.badge,
        removesWatermark: values.removesWatermark,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
        updatedAt: new Date(),
      },
    });
}

export async function setProductActive(id: string, active: boolean) {
  const res = await getDb().update(pricingPlans).set({ isActive: active }).where(eq(pricingPlans.id, id)).returning({ id: pricingPlans.id });
  if (res.length === 0) throw new AppError("not_found", "Product not found");
}

// ─── Music library ──────────────────────────────────────────────────────────

const MAX_TRACK_BYTES = 20 * 1024 * 1024;

export async function uploadLibraryTrack(input: { title: string; artist: string | null; license: string; bytes: Buffer; sortOrder: number }) {
  if (input.bytes.length === 0) throw new AppError("audio_empty", "Empty file");
  if (input.bytes.length > MAX_TRACK_BYTES) throw new AppError("audio_too_large", "Track larger than 20 MB");
  const fmt = detectAudioFormat(input.bytes);
  if (!fmt) throw new AppError("audio_unsupported", "Unsupported audio format (mp3, m4a, ogg, wav, flac, webm)");
  const id = randomUUID();
  const key = keys.libraryMusic(id, fmt.ext);
  await putObject(key, input.bytes, fmt.mime);
  const [row] = await getDb()
    .insert(musicTracks)
    .values({ id, ownerUserId: null, title: input.title.slice(0, 120), artist: input.artist?.slice(0, 120) ?? null, license: input.license.slice(0, 300), storageKey: key, isGenerated: false, sortOrder: input.sortOrder })
    .returning();
  return row!;
}

export async function setTrackActive(id: string, active: boolean) {
  const res = await getDb()
    .update(musicTracks)
    .set({ isActive: active })
    .where(and(eq(musicTracks.id, id), isNull(musicTracks.ownerUserId)))
    .returning({ id: musicTracks.id });
  if (res.length === 0) throw new AppError("not_found", "Track not found");
}

export async function deleteLibraryTrack(id: string) {
  const db = getDb();
  const [t] = await db
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.id, id), isNull(musicTracks.ownerUserId)));
  if (!t) throw new AppError("not_found", "Track not found");
  await db.delete(musicTracks).where(eq(musicTracks.id, id));
  await deleteObjects([t.storageKey]).catch(() => undefined);
}

// ─── Format examples ────────────────────────────────────────────────────────

export async function setFormatExamples(slideshowMediaId: string | null, videoMediaId: string | null, adminTelegramId: number) {
  const db = getDb();
  for (const [id, type] of [
    [slideshowMediaId, "slideshow"],
    [videoMediaId, "video"],
  ] as const) {
    if (!id) continue;
    const [m] = await db.select().from(dreamMedia).where(and(eq(dreamMedia.id, id), isNull(dreamMedia.deletedAt)));
    if (!m || m.status !== "ready") throw new AppError("not_found", `Media ${id} not found or not ready`);
    if (m.mediaType !== type) throw new AppError("validation_failed", `Media ${id} is a ${m.mediaType}, expected ${type}`);
    // Examples are shown to every user — only results whose owner consented to publication qualify.
    const [d] = await db.select({ consent: dreams.publicationConsentAt, deletedAt: dreams.deletedAt }).from(dreams).where(eq(dreams.id, m.dreamId));
    if (!d || d.deletedAt || !d.consent) throw new AppError("forbidden", `The owner of media ${id} has not consented to publication`);
  }
  await updateSettings("formatExamples", { slideshowMediaId, videoMediaId }, adminTelegramId);
}

// ─── Channel posts ──────────────────────────────────────────────────────────

export async function updateChannelPostDraft(postId: string, patch: { caption: string; buttonText: string | null }) {
  const res = await getDb()
    .update(channelPosts)
    .set({ caption: patch.caption.slice(0, 1024), buttonText: patch.buttonText })
    .where(and(eq(channelPosts.id, postId), eq(channelPosts.status, "draft")))
    .returning({ id: channelPosts.id });
  if (res.length === 0) throw new AppError("conflict", "Only drafts can be edited");
}

/** Failed posts can be moved back to draft for another attempt. */
export async function resetChannelPostToDraft(postId: string) {
  const res = await getDb()
    .update(channelPosts)
    .set({ status: "draft", error: null })
    .where(and(eq(channelPosts.id, postId), inArray(channelPosts.status, ["failed", "cancelled"])))
    .returning({ id: channelPosts.id });
  if (res.length === 0) throw new AppError("conflict", "Only failed or cancelled posts can be reset");
}

// ─── Support ────────────────────────────────────────────────────────────────

export async function closeTicket(ticketId: string) {
  const res = await getDb().update(supportTickets).set({ status: "closed" }).where(eq(supportTickets.id, ticketId)).returning({ id: supportTickets.id });
  if (res.length === 0) throw new AppError("not_found", "Ticket not found");
}

// ─── Team ───────────────────────────────────────────────────────────────────

export async function addAdmin(telegramId: number, role: AdminRole, note: string | null) {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new AppError("validation_failed", "Invalid Telegram id");
  await getDb()
    .insert(adminUsers)
    .values({ telegramId, role, note })
    .onConflictDoUpdate({ target: adminUsers.telegramId, set: { role, note } });
}

export async function removeAdmin(telegramId: number, actingTelegramId: number) {
  if (envOwnerIds().includes(telegramId)) throw new AppError("conflict", "Owners from ADMIN_TELEGRAM_IDS can only be removed via the environment");
  if (telegramId === actingTelegramId) throw new AppError("conflict", "You cannot remove yourself");
  const res = await getDb().delete(adminUsers).where(eq(adminUsers.telegramId, telegramId)).returning({ id: adminUsers.id });
  if (res.length === 0) throw new AppError("not_found", "Admin not found");
}
