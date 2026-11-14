import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { ACTIVE_JOB_STATUSES, dreamScenes, dreams, generationJobs, musicTracks, users, visualStyles } from "../db/schema";
import { isUniqueViolation, pgConstraint } from "../db/errors";
import type { JobOptions } from "../db/types";
import type { JobDto, MusicTrackDto, QuoteDto, StartGenerationBody, StyleDto } from "../dto";
import { AppError } from "../errors";
import type { Locale } from "../i18n";
import { enqueue, getQueue, QUEUES } from "../queue";
import { hitRateLimit } from "../redis";
import { getSettings, type Settings } from "../settings";
import { sha256 } from "../utils";
import { videoActionFor, videoDurationOptions, planVideoClips } from "../ai/compose";
import { findImageModel } from "../ai/models";
import { effectiveVideoSpec, isDemoSelection } from "../ai/registry";
import { assertSpendBudget } from "./ai-usage";
import { track } from "./analytics";
import { applyCreditChange, cancelJobAndRelease, releaseJobCredits } from "./credits";
import { getOwnedDream, jobDto, type DreamRow } from "./dreams";
import { getMediaByIds, mediaDto } from "./media";
import { getActionPrices, type PriceAction } from "./pricing";
import { assertActive, type UserRow } from "./users";
import { signMediaUrl } from "../storage";

export type JobRow = typeof generationJobs.$inferSelect;

export async function listStyles(locale: Locale): Promise<StyleDto[]> {
  const rows = await getDb().select().from(visualStyles).where(eq(visualStyles.isActive, true)).orderBy(asc(visualStyles.sortOrder));
  return rows.map((s) => ({ id: s.id, name: locale === "en" ? s.nameEn : s.nameRu, swatch: s.swatch }));
}

export async function listMusic(userId: string): Promise<MusicTrackDto[]> {
  const rows = await getDb()
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.isActive, true), or(isNull(musicTracks.ownerUserId), eq(musicTracks.ownerUserId, userId))))
    .orderBy(asc(musicTracks.sortOrder), asc(musicTracks.createdAt));
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    durationSec: t.durationSec,
    isOwn: t.ownerUserId === userId,
    isGenerated: t.isGenerated,
    previewUrl: signMediaUrl(`music-${t.id}`),
  }));
}

export function watermarkApplies(settings: Settings, user: Pick<UserRow, "hasPaid">): boolean {
  if (settings.watermark.mode === "always") return true;
  if (settings.watermark.mode === "never") return false;
  return !user.hasPaid;
}

async function currentSceneCount(dream: DreamRow): Promise<number> {
  const [r] = await getDb()
    .select({ n: count() })
    .from(dreamScenes)
    .where(and(eq(dreamScenes.dreamId, dream.id), eq(dreamScenes.analysisVersion, dream.analysisVersion)));
  return r?.n ?? 0;
}

export async function getQuote(user: UserRow, dreamId: string, locale: Locale): Promise<QuoteDto> {
  const dream = await getOwnedDream(user.id, dreamId);
  const settings = await getSettings();
  const prices = await getActionPrices();
  const sceneCount = await currentSceneCount(dream);
  const spec = effectiveVideoSpec(settings);
  const options = videoDurationOptions(settings.generation.videoDurations, settings.generation.maxVideoDurationSec, spec.clipDurations, sceneCount).map((o) => {
    const action = videoActionFor(o.actualSec);
    return { ...o, action, credits: prices[action] };
  });
  const freeLeft = Math.max(0, settings.limits.freeSlideshowsPerUser - user.freeSlideshowsUsed);
  const ex = settings.formatExamples;
  const exampleMedia = await getMediaByIds([ex.slideshowMediaId, ex.videoMediaId].filter((x): x is string => Boolean(x)));
  // Re-check the owner's publication consent at display time (it can be withdrawn).
  const exampleDreamIds = [...new Set([...exampleMedia.values()].map((m) => m.dreamId))];
  const consented = new Set(
    exampleDreamIds.length
      ? (
          await getDb()
            .select({ id: dreams.id })
            .from(dreams)
            .where(and(inArray(dreams.id, exampleDreamIds), isNotNull(dreams.publicationConsentAt), isNull(dreams.deletedAt)))
        ).map((d) => d.id)
      : [],
  );
  const exampleDto = (id: string | null) => {
    const m = id ? exampleMedia.get(id) : undefined;
    return m && m.status === "ready" && consented.has(m.dreamId) ? { ...mediaDto(m), downloadUrl: null } : null;
  };
  return {
    balance: user.creditsBalance,
    reserved: user.creditsReserved,
    freeSlideshowsLeft: freeLeft,
    slideshow: {
      credits: freeLeft > 0 ? 0 : prices.slideshow,
      free: freeLeft > 0,
      sceneCount,
      estimatedSec: Math.round(sceneCount * settings.generation.slideshowSecondsPerScene),
      action: "slideshow",
    },
    video: { options, clipDurations: spec.clipDurations, modelLabel: spec.label },
    sceneImageCredits: prices.scene_image,
    sceneVideoCredits: prices.scene_video,
    styles: await listStyles(locale),
    music: await listMusic(user.id),
    watermark: { applies: watermarkApplies(settings, user), removableByPurchase: settings.watermark.mode === "free_only" },
    demo: isDemoSelection(settings),
    examples: { slideshow: exampleDto(ex.slideshowMediaId), video: exampleDto(ex.videoMediaId) },
  };
}

function estimateUsd(settings: Settings, format: "slideshow" | "video", sceneCount: number, videoSec: number): number {
  const img = findImageModel(settings.models.image.model)?.costPerImageUsd ?? 0.03;
  const refs = settings.models.image.referenceModel ? 2 * (findImageModel(settings.models.image.referenceModel)?.costPerImageUsd ?? 0.04) : 0;
  const base = sceneCount * img + refs;
  if (format === "slideshow") return base;
  return base + videoSec * effectiveVideoSpec(settings).costPerSecondUsd;
}

interface StartArgs extends StartGenerationBody {
  kind?: "full" | "scene_image" | "scene_video" | "rerender";
  sceneId?: string;
  locale: Locale;
}

/**
 * Starts a generation. Credits are reserved atomically together with the job
 * row; the same idempotency key always returns the same job, and a partial
 * unique index forbids two active jobs of one format for one dream.
 */
export async function startGeneration(user: UserRow, dreamId: string, args: StartArgs): Promise<JobDto> {
  assertActive(user);
  const db = getDb();
  const kind = args.kind ?? "full";
  const idem = args.idempotencyKey.slice(0, 80);

  // Idempotent replay: same key → same job.
  const [existing] = await db.select().from(generationJobs).where(and(eq(generationJobs.userId, user.id), eq(generationJobs.idempotencyKey, idem)));
  if (existing) {
    // A key belongs to one request: reusing it for another dream/format/kind is a client bug.
    if (existing.dreamId !== dreamId || existing.mediaType !== args.format || existing.kind !== kind) throw new AppError("conflict", "Idempotency key already used for another request");
    return jobDto(existing, new Map());
  }

  const dream = await getOwnedDream(user.id, dreamId);
  if (dream.status !== "ready" || !dream.bible) throw new AppError("dream_not_ready", "Dream analysis is not ready");
  if (dream.analysisTextHash && dream.editedText && sha256(dream.editedText) !== dream.analysisTextHash) {
    throw new AppError("dream_not_ready", "Dream text changed — confirm it again");
  }
  const settings = await getSettings();
  const prices = await getActionPrices();
  const sceneCount = await currentSceneCount(dream);
  if (sceneCount === 0) throw new AppError("dream_not_ready", "No scenes");

  const [style] = await db.select().from(visualStyles).where(and(eq(visualStyles.id, args.styleId), eq(visualStyles.isActive, true)));
  if (!style) throw new AppError("validation_failed", "Unknown style");
  if (args.musicTrackId) {
    const [track] = await db
      .select({ id: musicTracks.id })
      .from(musicTracks)
      .where(and(eq(musicTracks.id, args.musicTrackId), eq(musicTracks.isActive, true), or(isNull(musicTracks.ownerUserId), eq(musicTracks.ownerUserId, user.id))));
    if (!track) throw new AppError("validation_failed", "Unknown music track");
  }

  let action: PriceAction;
  let targetDurationSec: number | undefined;
  let videoSec = 0;
  if (kind === "scene_image") action = "scene_image";
  else if (kind === "scene_video") action = "scene_video";
  else if (kind === "rerender") action = "rerender";
  else if (args.format === "slideshow") action = "slideshow";
  else {
    const spec = effectiveVideoSpec(settings);
    const options = videoDurationOptions(settings.generation.videoDurations, settings.generation.maxVideoDurationSec, spec.clipDurations, sceneCount);
    const opt = options.find((o) => o.targetSec === args.targetDurationSec || o.actualSec === args.targetDurationSec);
    if (!opt) throw new AppError("validation_failed", "Unsupported video duration", { details: { options: options.map((o) => o.actualSec) } });
    targetDurationSec = opt.actualSec;
    videoSec = opt.actualSec;
    action = videoActionFor(opt.actualSec);
  }
  if (kind === "scene_image" || kind === "scene_video") {
    if (!args.sceneId) throw new AppError("validation_failed", "sceneId required");
    const [scene] = await db.select({ id: dreamScenes.id }).from(dreamScenes).where(and(eq(dreamScenes.id, args.sceneId), eq(dreamScenes.dreamId, dream.id), eq(dreamScenes.analysisVersion, dream.analysisVersion)));
    if (!scene) throw new AppError("not_found", "Scene not found");
    if (kind === "scene_video") {
      // A new clip is only useful for a scene that is part of the film's cut.
      const [lastVideo] = await db
        .select({ detail: generationJobs.stageDetail })
        .from(generationJobs)
        .where(and(eq(generationJobs.dreamId, dream.id), eq(generationJobs.mediaType, "video"), eq(generationJobs.status, "completed")))
        .orderBy(desc(generationJobs.finishedAt))
        .limit(1);
      const plan = lastVideo?.detail?.plan;
      if (plan && !plan.some((p) => p.sceneId === args.sceneId)) throw new AppError("validation_failed", "This scene is not part of the video", { details: { reason: "scene_not_in_video" } });
    }
  }

  const rl = await hitRateLimit(`gen:${user.id}`, settings.limits.maxGenerationsPerDay, 86_400);
  if (!rl.allowed) throw new AppError("rate_limited", "Daily generation limit reached");

  const estimate = kind === "full" ? estimateUsd(settings, args.format, sceneCount, videoSec) : kind === "rerender" ? 0 : 0.3;
  const wantsFree = kind === "full" && args.format === "slideshow" && user.freeSlideshowsUsed < settings.limits.freeSlideshowsPerUser;
  await assertSpendBudget(estimate, { free: wantsFree });

  const [{ n: previousFull } = { n: 0 }] = await db
    .select({ n: count() })
    .from(generationJobs)
    .where(and(eq(generationJobs.dreamId, dream.id), eq(generationJobs.mediaType, args.format), eq(generationJobs.kind, "full"), eq(generationJobs.status, "completed")));

  const options: JobOptions = {
    styleId: style.id,
    targetDurationSec,
    musicTrackId: args.musicTrackId ?? null,
    watermark: watermarkApplies(settings, user),
    action,
    locale: args.locale,
    variant: kind === "full" ? previousFull : undefined,
  };

  const demo = isDemoSelection(settings);
  let job: JobRow;
  try {
    job = await db.transaction(async (tx) => {
      let free = false;
      if (wantsFree) {
        const r = await tx
          .update(users)
          .set({ freeSlideshowsUsed: sql`${users.freeSlideshowsUsed} + 1` })
          .where(and(eq(users.id, user.id), sql`${users.freeSlideshowsUsed} < ${settings.limits.freeSlideshowsPerUser}`))
          .returning({ id: users.id });
        free = r.length > 0;
      }
      const cost = free ? 0 : prices[action];
      const [created] = await tx
        .insert(generationJobs)
        .values({
          userId: user.id,
          dreamId: dream.id,
          mediaType: args.format,
          kind,
          sceneId: args.sceneId,
          status: "queued",
          currentStage: "queued",
          options,
          provider: findImageModel(settings.models.image.model)?.provider,
          model: settings.models.image.model,
          videoProvider: args.format === "video" ? effectiveVideoSpec(settings).provider : null,
          videoModel: args.format === "video" ? settings.models.video.model : null,
          idempotencyKey: idem,
          creditsCost: cost,
          creditState: cost > 0 || free ? "reserved" : "none",
          usedFreeAllowance: free,
          estimatedCostUsd: Number(estimate.toFixed(4)),
          isDemo: demo.image || (args.format === "video" && demo.video),
        })
        .returning();
      if (cost > 0) {
        await applyCreditChange(tx, { userId: user.id, amount: -cost, reservedDelta: cost, type: "reserve", jobId: created!.id, source: action });
      }
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const constraint = pgConstraint(err);
      if (constraint === "generation_jobs_idem_uq") {
        const [again] = await db.select().from(generationJobs).where(and(eq(generationJobs.userId, user.id), eq(generationJobs.idempotencyKey, idem)));
        if (again) return jobDto(again, new Map());
      }
      throw new AppError("job_already_running", "A generation of this format is already running");
    }
    throw err;
  }

  try {
    await enqueue(args.format === "video" ? QUEUES.video : QUEUES.slideshow, { jobId: job.id }, { jobId: job.id, attempts: settings.generation.maxAttempts });
  } catch (err) {
    // Could not enqueue — compensate so the user is not charged for nothing.
    await db.update(generationJobs).set({ status: "failed", errorCode: "internal", finishedAt: new Date() }).where(eq(generationJobs.id, job.id));
    await releaseJobCredits(job.id, "enqueue_failed");
    throw err;
  }
  await track("generation_started", user.id, { format: args.format, kind, action, credits: job.creditsCost, free: job.usedFreeAllowance });
  return jobDto(job, new Map());
}

export async function getJobForUser(user: UserRow, jobId: string): Promise<JobDto> {
  const [job] = await getDb()
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.userId, user.id)));
  if (!job) throw new AppError("not_found", "Job not found");
  const media = await getMediaByIds(job.stageDetail?.previewMediaIds ?? []);
  return jobDto(job, media);
}

/** Cancels an active job; reserved credits are returned. The worker stops at the next checkpoint. */
export async function cancelJob(user: UserRow, jobId: string): Promise<JobDto> {
  const job = await cancelJobAndRelease(jobId, "cancelled", { userId: user.id });
  if (!job) throw new AppError("conflict", "Job is not active");
  const q = getQueue(job.mediaType === "video" ? QUEUES.video : QUEUES.slideshow);
  const bull = await q.getJob(job.id);
  if (bull && (await bull.isWaiting().catch(() => false))) await bull.remove().catch(() => undefined);
  return jobDto(job, new Map());
}

/** Plan preview used by the worker and tests. */
export { planVideoClips };
