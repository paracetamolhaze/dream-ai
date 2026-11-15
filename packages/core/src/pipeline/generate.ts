import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";
import { composeNegativePrompt, composeVideoPrompt, planVideoClips, type StylePreset } from "../ai/compose";
import { getImageProvider, getVideoProvider } from "../ai/registry";
import type { ImageProvider, VideoProvider, VideoTaskStatus } from "../ai/types";
import { getDb } from "../db/client";
import { ACTIVE_JOB_STATUSES, dreamMedia, dreamScenes, dreams, generationJobs, musicTracks, users } from "../db/schema";
import type { DreamBible, StageDetail } from "../db/types";
import { AppError, ProviderError } from "../errors";
import { logger } from "../logger";
import { assemble, cameraMoveFromHint, kenBurnsClip, normalizeClip, type Canvas } from "../media/ffmpeg";
import { recordUsage } from "../services/ai-usage";
import { track } from "../services/analytics";
import { applyCreditChange, finishJobAndRelease } from "../services/credits";
import { notifyGenerationCompleted, notifyGenerationFailed } from "../services/notify";
import type { UserRow } from "../services/users";
import { getSettings, type Settings } from "../settings";
import { downloadToFile } from "../storage";
import { sha256 } from "../utils";
import {
  clipInputHash,
  downloadUrlToFile,
  findCachedMedia,
  imageInputFor,
  latestReadyMedia,
  mediaToLocalFile,
  storeResultVideo,
  uploadVideoFile,
  type MediaRow,
} from "./assets";
import {
  classifyError,
  createJobDir,
  isFinalAttempt,
  JobCancelledError,
  produceOnce,
  removeDir,
  runPool,
  sleepWithSignal,
  throwIfAborted,
  type AttemptInfo,
  type ClassifiedError,
} from "./common";
import { ensureFrame, ensureReferencePortrait, loadStylePreset, type SceneRow } from "./frames";

const log = logger.child({ step: "generation" });

export type JobRow = typeof generationJobs.$inferSelect;
type JobStatus = JobRow["status"];
type DreamRow = typeof dreams.$inferSelect;

const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);
const SLIDESHOW_TRANSITION = 0.8;
const VIDEO_TRANSITION = 0.5;

// ─── Progress reporting ─────────────────────────────────────────────────────

/**
 * Serialized writer for job status/progress. Every write is conditional on the
 * job still being active; if it is not (the user cancelled, the dream was
 * deleted), the pipeline's abort controller fires and work stops at the next
 * checkpoint. Progress never goes backwards.
 */
export class ProgressReporter {
  private chain: Promise<void> = Promise.resolve();
  detail: StageDetail;
  private pct: number;

  constructor(
    private readonly jobId: string,
    initial: Pick<JobRow, "stageDetail" | "progress">,
    private readonly abort: AbortController,
  ) {
    this.detail = { ...(initial.stageDetail ?? {}) };
    this.pct = initial.progress;
  }

  update(status: JobStatus, pct: number, patch: Partial<StageDetail> = {}): Promise<void> {
    this.pct = Math.max(this.pct, Math.min(99, Math.round(pct)));
    Object.assign(this.detail, patch);
    const snapshot = { status, pct: this.pct, detail: { ...this.detail } };
    this.chain = this.chain
      .then(async () => {
        const rows = await getDb()
          .update(generationJobs)
          .set({
            status: snapshot.status,
            currentStage: snapshot.status,
            progress: sql`greatest(${generationJobs.progress}, ${snapshot.pct})`,
            stageDetail: snapshot.detail,
            heartbeatAt: new Date(),
          })
          .where(and(eq(generationJobs.id, this.jobId), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])))
          .returning({ id: generationJobs.id });
        if (rows.length === 0) this.abort.abort("cancelled");
      })
      .catch((err: Error) => log.warn("progress update failed", { jobId: this.jobId, error: err.message }));
    return this.chain;
  }

  heartbeat(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const rows = await getDb()
          .update(generationJobs)
          .set({ heartbeatAt: new Date() })
          .where(and(eq(generationJobs.id, this.jobId), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])))
          .returning({ id: generationJobs.id });
        if (rows.length === 0) this.abort.abort("cancelled");
      })
      .catch((err: Error) => log.warn("heartbeat failed", { jobId: this.jobId, error: err.message }));
    return this.chain;
  }

  drain(): Promise<void> {
    return this.chain.catch(() => undefined);
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

interface Ctx {
  job: JobRow;
  dream: DreamRow;
  user: UserRow;
  settings: Settings;
  bible: DreamBible;
  scenes: SceneRow[];
  analysisVersion: number;
  style: StylePreset;
  styleId: string;
  canvas: Canvas;
  dir: string;
  signal: AbortSignal;
  progress: ProgressReporter;
  imageProvider: ImageProvider;
  refProvider: ImageProvider | null;
  videoProvider: VideoProvider | null;
}

interface PipelineResult {
  /** Final asset shown to the user (slideshow/video, or the regenerated frame/clip). */
  mediaId: string | null;
  /** A new slideshow/video version was produced. */
  createdResult: boolean;
  coverImageId: string | null;
  notify: boolean;
  durationSec?: number | null;
}

async function loadScenes(dreamId: string, version: number): Promise<SceneRow[]> {
  return getDb()
    .select()
    .from(dreamScenes)
    .where(and(eq(dreamScenes.dreamId, dreamId), eq(dreamScenes.analysisVersion, version)))
    .orderBy(asc(dreamScenes.sequenceNumber));
}

/** Most recent completed full job of a dream (optionally of one format). */
async function latestCompletedJob(dreamId: string, mediaType?: "slideshow" | "video"): Promise<JobRow | undefined> {
  const conds = [eq(generationJobs.dreamId, dreamId), eq(generationJobs.status, "completed"), inArray(generationJobs.kind, ["full", "rerender"])];
  if (mediaType) conds.push(eq(generationJobs.mediaType, mediaType));
  const [j] = await getDb()
    .select()
    .from(generationJobs)
    .where(and(...conds))
    .orderBy(desc(generationJobs.finishedAt))
    .limit(1);
  return j;
}

async function buildContext(job: JobRow, dir: string, signal: AbortSignal, progress: ProgressReporter): Promise<Ctx> {
  const db = getDb();
  const [dream] = await db.select().from(dreams).where(eq(dreams.id, job.dreamId));
  if (!dream || dream.deletedAt) throw new JobCancelledError("dream deleted");
  const [user] = await db.select().from(users).where(eq(users.id, job.userId));
  if (!user || user.status === "deleted") throw new JobCancelledError("account deleted");
  const settings = await getSettings({ fresh: true });

  await progress.update("analyzing", 2);
  // Bind the job to one analysis version on the first run; retries reuse it.
  let analysisVersion = progress.detail.analysisVersion;
  if (analysisVersion === undefined) {
    if (dream.status !== "ready" || !dream.bible) throw new AppError("dream_not_ready", "dream analysis is not ready", { retryable: false });
    if (dream.analysisTextHash && dream.editedText && sha256(dream.editedText) !== dream.analysisTextHash) {
      throw new AppError("dream_not_ready", "dream text changed after analysis", { retryable: false });
    }
    analysisVersion = dream.analysisVersion;
  }
  if (!dream.bible) throw new AppError("dream_not_ready", "dream has no bible", { retryable: false });
  const scenes = await loadScenes(dream.id, analysisVersion);
  if (scenes.length === 0) throw new AppError("dream_not_ready", "dream has no scenes", { retryable: false });

  // Scene regenerations keep the look of the existing result.
  let requestedStyle = job.options.styleId;
  if (job.kind !== "full") {
    const prev = (await latestCompletedJob(dream.id, job.mediaType)) ?? (await latestCompletedJob(dream.id));
    if (prev?.options.styleId) requestedStyle = prev.options.styleId;
  }
  const { styleId, preset } = await loadStylePreset(requestedStyle, dream.bible);

  const imageProvider = getImageProvider(job.model ?? settings.models.image.model);
  let refProvider: ImageProvider | null = null;
  const refModel = settings.models.image.referenceModel;
  if (refModel) {
    try {
      const p = getImageProvider(refModel);
      if (p.spec.supportsReferenceImage) refProvider = p;
    } catch (err) {
      log.info("reference model unavailable — continuing without character references", { error: (err as Error).message });
    }
  }
  const needsVideo = (job.kind === "full" && job.mediaType === "video") || job.kind === "scene_video";
  const videoProvider = needsVideo ? getVideoProvider(job.videoModel ?? settings.models.video.model) : null;

  await progress.update("analyzing", 4, { analysisVersion });
  return {
    job,
    dream,
    user,
    settings,
    bible: dream.bible,
    scenes,
    analysisVersion,
    style: preset,
    styleId,
    canvas: { width: settings.generation.outputWidth, height: settings.generation.outputHeight, fps: settings.generation.fps },
    dir,
    signal,
    progress,
    imageProvider,
    refProvider,
    videoProvider,
  };
}

// ─── Stages ─────────────────────────────────────────────────────────────────

/** Character references for characters that appear in several frames (only with reference-capable models). */
async function ensureReferences(ctx: Ctx, scenes: SceneRow[], opts: { create: boolean; from: number; to: number }): Promise<Map<string, MediaRow>> {
  const refs = new Map<string, MediaRow>();
  if (!ctx.refProvider) return refs;
  const counts = new Map<string, number>();
  for (const s of scenes) for (const k of s.characters) counts.set(k, (counts.get(k) ?? 0) + 1);
  const candidates = ctx.bible.characters.filter((c) => (counts.get(c.key) ?? 0) >= (opts.create ? 2 : 1));
  let done = 0;
  for (const character of candidates) {
    throwIfAborted(ctx.signal);
    const media = await ensureReferencePortrait({
      dreamId: ctx.dream.id,
      userId: ctx.user.id,
      jobId: ctx.job.id,
      character,
      bible: ctx.bible,
      style: ctx.style,
      styleId: ctx.styleId,
      provider: ctx.imageProvider,
      dir: ctx.dir,
      owner: ctx.job.id,
      create: opts.create,
      signal: ctx.signal,
    });
    if (media) refs.set(character.key, media);
    done++;
    await ctx.progress.update("preparing_scenes", opts.from + ((opts.to - opts.from) * done) / candidates.length);
  }
  return refs;
}

function referenceFor(ctx: Ctx, scene: SceneRow, refs: Map<string, MediaRow>): MediaRow | null {
  if (refs.size === 0) return null;
  const ordered = [...scene.characters].sort((a, b) => {
    const ra = ctx.bible.characters.find((c) => c.key === a)?.role === "protagonist" ? 0 : 1;
    const rb = ctx.bible.characters.find((c) => c.key === b)?.role === "protagonist" ? 0 : 1;
    return ra - rb;
  });
  for (const k of ordered) {
    const m = refs.get(k);
    if (m) return m;
  }
  return null;
}

async function generateFrames(ctx: Ctx, scenes: SceneRow[], refs: Map<string, MediaRow>, opts: { from: number; to: number; variant: number }): Promise<MediaRow[]> {
  const total = scenes.length;
  let done = 0;
  const previews: (string | null)[] = scenes.map(() => null);
  await ctx.progress.update("generating_images", opts.from, { done: 0, total, previewMediaIds: [] });
  return runPool(scenes, ctx.settings.concurrency.imagesPerJob, ctx.signal, async (scene, i, signal) => {
    const reference = referenceFor(ctx, scene, refs);
    const provider = reference && ctx.refProvider ? ctx.refProvider : ctx.imageProvider;
    const media = await ensureFrame({
      dreamId: ctx.dream.id,
      userId: ctx.user.id,
      jobId: ctx.job.id,
      scene,
      bible: ctx.bible,
      style: ctx.style,
      styleId: ctx.styleId,
      provider,
      reference: provider === ctx.refProvider ? reference : null,
      variant: opts.variant,
      dir: ctx.dir,
      owner: ctx.job.id,
      signal,
    });
    previews[i] = media.id;
    done++;
    await ctx.progress.update("generating_images", opts.from + ((opts.to - opts.from) * done) / total, {
      done,
      total,
      previewMediaIds: previews.filter((x): x is string => Boolean(x)),
    });
    return media;
  });
}

// ─── Video clips ────────────────────────────────────────────────────────────

export interface ClipArgs {
  dreamId: string;
  userId: string;
  jobId: string;
  sceneId: string;
  keyframe: MediaRow;
  provider: VideoProvider;
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  seed?: number;
  variant: number;
  dir: string;
  signal: AbortSignal;
  timeoutMs: number;
  label?: string;
  pollMinMs?: number;
  pollMaxMs?: number;
  /** Test hook: called right after the provider task id is persisted. */
  onSubmitted?: (clipMediaId: string, externalId: string) => void | Promise<void>;
}

async function markClip(id: string, status: "failed" | "ready", patch: Partial<typeof dreamMedia.$inferInsert> = {}) {
  await getDb()
    .update(dreamMedia)
    .set({ status, ...patch })
    .where(eq(dreamMedia.id, id));
}

async function pollVideo(a: ClipArgs, externalId: string): Promise<VideoTaskStatus & { timedOut?: boolean }> {
  const deadline = Date.now() + a.timeoutMs;
  let delay = a.pollMinMs ?? 5000;
  for (;;) {
    throwIfAborted(a.signal);
    let st: VideoTaskStatus;
    try {
      st = await a.provider.getStatus(externalId, { userId: a.userId, jobId: a.jobId, dreamId: a.dreamId, signal: a.signal });
    } catch (err) {
      if (a.signal.aborted) throw new JobCancelledError(String(a.signal.reason));
      if (err instanceof ProviderError && !err.retryable) throw err;
      log.warn("video status poll failed (will retry)", { externalId: externalId.slice(0, 80), error: (err as Error).message });
      st = { state: "running" };
    }
    if (st.state === "succeeded" || st.state === "failed" || st.state === "cancelled") return st;
    if (Date.now() > deadline) return { state: "failed", error: "video generation timed out", retryable: false, timedOut: true };
    await sleepWithSignal(delay, a.signal);
    delay = Math.min(a.pollMaxMs ?? 20_000, Math.round(delay * 1.5));
  }
}

/**
 * Produces one video clip from a keyframe. The provider task id is stored on
 * a `processing` media row right after submission, so a restarted worker
 * resumes polling the same task instead of paying for a new one.
 */
export async function ensureClip(a: ClipArgs): Promise<MediaRow> {
  const db = getDb();
  const hash = clipInputHash({
    keyframeMediaId: a.keyframe.id,
    prompt: a.prompt,
    negative: a.negativePrompt,
    durationSec: a.durationSec,
    modelId: a.provider.spec.id,
    seed: a.seed,
    variant: a.variant,
  });
  return produceOnce({
    key: `lock:asset:${a.dreamId}:${hash}`,
    owner: a.jobId,
    ttlMs: a.timeoutMs + 5 * 60_000,
    waitMs: a.timeoutMs + 5 * 60_000,
    signal: a.signal,
    lookup: () => findCachedMedia(a.dreamId, hash, "video_clip"),
    produce: async () => {
      const ctx = { userId: a.userId, jobId: a.jobId, dreamId: a.dreamId, signal: a.signal };
      let [row] = await db
        .select()
        .from(dreamMedia)
        .where(and(eq(dreamMedia.dreamId, a.dreamId), eq(dreamMedia.inputHash, hash), eq(dreamMedia.mediaType, "video_clip"), eq(dreamMedia.status, "processing"), isNull(dreamMedia.deletedAt)))
        .orderBy(desc(dreamMedia.createdAt))
        .limit(1);
      let externalId = row?.externalJobId ?? null;
      const resumed = Boolean(row && externalId);
      if (resumed) log.info("resuming video task", { clipId: row!.id });
      if (!row) {
        [row] = await db
          .insert(dreamMedia)
          .values({
            id: randomUUID(),
            dreamId: a.dreamId,
            userId: a.userId,
            sceneId: a.sceneId,
            jobId: a.jobId,
            mediaType: "video_clip",
            format: "mp4",
            status: "processing",
            provider: a.provider.spec.provider,
            model: a.provider.spec.model,
            seed: a.seed ?? null,
            prompt: a.prompt.slice(0, 4000),
            inputHash: hash,
            isDemo: a.provider.isDemo,
            durationSec: a.durationSec,
          })
          .returning();
      }
      const clip = row!;
      const startedAt = Date.now();
      if (!externalId) {
        const image = await imageInputFor(a.keyframe, a.dir);
        try {
          externalId = (await a.provider.submit({ prompt: a.prompt, negativePrompt: a.negativePrompt, durationSec: a.durationSec, image, seed: a.seed, label: a.label }, ctx)).externalId;
        } catch (err) {
          if (a.signal.aborted) throw new JobCancelledError(String(a.signal.reason));
          await markClip(clip.id, "failed", { errorCode: (err as ProviderError).code ?? "generation_failed" });
          await recordUsage({ kind: "video", provider: a.provider.spec.provider, model: a.provider.spec.model, costUsd: 0, success: false, error: (err as Error).message, isDemo: a.provider.isDemo, userId: a.userId, jobId: a.jobId, dreamId: a.dreamId }).catch(() => undefined);
          throw err;
        }
        await db.update(dreamMedia).set({ externalJobId: externalId }).where(eq(dreamMedia.id, clip.id));
        await a.onSubmitted?.(clip.id, externalId);
      }

      let st: Awaited<ReturnType<typeof pollVideo>>;
      try {
        st = await pollVideo(a, externalId);
      } catch (err) {
        // User cancellation stops the paid task; any other stop (worker shutdown,
        // a sibling clip failing) leaves it running so a retry can resume it.
        if (a.signal.aborted && a.signal.reason === "cancelled") {
          await a.provider.cancel?.(externalId).catch(() => undefined);
          await markClip(clip.id, "failed", { errorCode: "cancelled" });
        } else if (!a.signal.aborted && ((err instanceof ProviderError && !err.retryable) || err instanceof AppError)) {
          // A task the provider definitively refuses to report on can never be resumed —
          // release the row so the next attempt submits a fresh task instead of looping.
          await markClip(clip.id, "failed", { errorCode: err instanceof ProviderError ? err.code : (err as AppError).code });
        }
        throw err;
      }

      if (st.state !== "succeeded" || !st.videoUrl) {
        const rejected = Boolean(st.rejectedContent);
        await markClip(clip.id, "failed", { errorCode: rejected ? "provider_rejected_content" : st.timedOut ? "provider_timeout" : "generation_failed" });
        await recordUsage({ kind: "video", provider: a.provider.spec.provider, model: a.provider.spec.model, costUsd: 0, success: false, error: st.error ?? st.state, isDemo: a.provider.isDemo, userId: a.userId, jobId: a.jobId, dreamId: a.dreamId }).catch(() => undefined);
        if (rejected) throw new AppError("provider_rejected_content", st.error ?? "video rejected by provider", { retryable: false });
        if (st.timedOut) {
          await a.provider.cancel?.(externalId).catch(() => undefined);
          throw new ProviderError(a.provider.spec.provider, "video generation timed out", { retryable: false, code: "provider_timeout" });
        }
        throw new ProviderError(a.provider.spec.provider, st.error ?? `video task ${st.state}`, { retryable: st.retryable ?? true, code: "generation_failed" });
      }

      const local = path.join(a.dir, `${clip.id}.src.mp4`);
      let stored: Awaited<ReturnType<typeof uploadVideoFile>>;
      try {
        await downloadUrlToFile(st.videoUrl, local, a.provider.spec.provider, st.videoHeaders);
        stored = await uploadVideoFile({ userId: a.userId, dreamId: a.dreamId, mediaId: clip.id, file: local, dir: a.dir });
      } catch (err) {
        // First failure: keep the task so a retry can re-download it. A resumed task that
        // still can't be fetched (expired URL, broken file) is released for a fresh submit.
        if (resumed) await markClip(clip.id, "failed", { errorCode: "generation_failed" });
        throw err;
      }
      const costUsd = a.provider.spec.costPerSecondUsd * a.durationSec;
      const [ready] = await db
        .update(dreamMedia)
        .set({ ...stored, status: "ready", costUsd: Number(costUsd.toFixed(4)), errorCode: null })
        .where(eq(dreamMedia.id, clip.id))
        .returning();
      await recordUsage({
        kind: "video",
        provider: a.provider.spec.provider,
        model: a.provider.spec.model,
        costUsd,
        units: a.durationSec,
        unit: "second",
        durationMs: Date.now() - startedAt,
        isDemo: a.provider.isDemo,
        userId: a.userId,
        jobId: a.jobId,
        dreamId: a.dreamId,
      });
      return ready!;
    },
  });
}

function snapDuration(spec: { clipDurations: number[] }, d: number): number {
  return spec.clipDurations.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best), spec.clipDurations[0] ?? 5);
}

async function generateClips(ctx: Ctx, items: { scene: SceneRow; keyframe: MediaRow; durationSec: number }[], opts: { from: number; to: number; variant: number }): Promise<MediaRow[]> {
  const provider = ctx.videoProvider;
  if (!provider) throw new AppError("internal", "video provider missing", { retryable: false });
  const total = items.length;
  let done = 0;
  await ctx.progress.update("generating_video", opts.from, { done: 0, total });
  const negativeBase = provider.spec.supportsNegativePrompt ? composeNegativePrompt({ imagePrompt: "", videoPrompt: "", characters: [] }, ctx.style) : undefined;
  return runPool(items, ctx.settings.concurrency.clipsPerJob, ctx.signal, async (item, _i, signal) => {
    const base = item.scene.seed ?? ctx.bible.seed;
    const clip = await ensureClip({
      dreamId: ctx.dream.id,
      userId: ctx.user.id,
      jobId: ctx.job.id,
      sceneId: item.scene.id,
      keyframe: item.keyframe,
      provider,
      prompt: composeVideoPrompt(item.scene, ctx.bible),
      negativePrompt: negativeBase ? `${negativeBase}, morphing, flicker, distorted faces` : undefined,
      durationSec: snapDuration(provider.spec, item.durationSec),
      seed: provider.spec.supportsSeed ? (base + opts.variant * 7919) % 2147483647 : undefined,
      variant: opts.variant,
      dir: ctx.dir,
      signal,
      timeoutMs: ctx.settings.generation.jobTimeoutMinutes * 60_000,
      label: item.scene.title ?? undefined,
    });
    await getDb().update(dreamScenes).set({ currentClipId: clip.id }).where(eq(dreamScenes.id, item.scene.id));
    done++;
    await ctx.progress.update("generating_video", opts.from + ((opts.to - opts.from) * done) / total, { done, total });
    return clip;
  });
}

// ─── Rendering ──────────────────────────────────────────────────────────────

async function resolveMusic(ctx: Ctx, trackId: string | null | undefined): Promise<string | null> {
  if (!trackId) return null;
  const [t] = await getDb()
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.id, trackId), eq(musicTracks.isActive, true), or(isNull(musicTracks.ownerUserId), eq(musicTracks.ownerUserId, ctx.user.id))));
  if (!t) {
    // Deleted or deactivated after the job was created — never fail the job over music.
    log.warn("music track unavailable — rendering without music", { trackId });
    return null;
  }
  const ext = path.extname(t.storageKey).slice(1) || "mp3";
  const file = path.join(ctx.dir, `music-${t.id}.${ext}`);
  try {
    await downloadToFile(t.storageKey, file);
    return file;
  } catch (err) {
    log.warn("music file missing — rendering without music", { trackId, error: (err as Error).message });
    return null;
  }
}

function watermarkText(ctx: Ctx): string | null {
  return ctx.job.options.watermark ? ctx.settings.watermark.text : null;
}

async function renderSlideshow(ctx: Ctx, items: { scene: SceneRow; image: MediaRow }[], opts: { from: number; to: number; musicTrackId?: string | null }): Promise<MediaRow> {
  const n = items.length;
  if (n === 0) throw new AppError("generation_failed", "no frames to render", { retryable: false });
  const t = n > 1 ? SLIDESHOW_TRANSITION : 0;
  const per = ctx.settings.generation.slideshowSecondsPerScene;
  await ctx.progress.update("rendering", opts.from, { done: 0, total: n });
  const clips: { path: string; durationSec: number }[] = [];
  for (let i = 0; i < n; i++) {
    throwIfAborted(ctx.signal);
    const img = await mediaToLocalFile(items[i]!.image, ctx.dir);
    const out = path.join(ctx.dir, `kb-${i}.mp4`);
    const len = per + (i < n - 1 ? t : 0);
    await kenBurnsClip(img, out, { ...ctx.canvas, durationSec: len, move: cameraMoveFromHint(items[i]!.scene.motion, i) }, { signal: ctx.signal });
    clips.push({ path: out, durationSec: len });
    await ctx.progress.update("rendering", opts.from + ((opts.to - opts.from) * 0.85 * (i + 1)) / n, { done: i + 1, total: n });
  }
  const music = await resolveMusic(ctx, opts.musicTrackId);
  const wm = watermarkText(ctx);
  const output = path.join(ctx.dir, "slideshow.mp4");
  await assemble({ clips, output, canvas: ctx.canvas, transitionSec: t, musicPath: music, watermarkText: wm, workDir: ctx.dir }, { signal: ctx.signal });
  // Remember exactly what this slideshow is made of: scene regenerations start from it.
  await ctx.progress.update("rendering", opts.to, {
    frames: items.map((it) => ({ sceneId: it.scene.id, mediaId: it.image.id })),
    musicTrackId: music ? (opts.musicTrackId ?? null) : null,
  });
  return storeResultVideo({
    userId: ctx.user.id,
    dreamId: ctx.dream.id,
    jobId: ctx.job.id,
    type: "slideshow",
    file: output,
    dir: ctx.dir,
    model: ctx.imageProvider.spec.id,
    styleId: ctx.styleId,
    hasWatermark: Boolean(wm),
    isDemo: ctx.job.isDemo || items.some((it) => it.image.isDemo),
  });
}

async function renderVideo(ctx: Ctx, items: { clip: MediaRow; durationSec: number }[], opts: { from: number; to: number; musicTrackId?: string | null }): Promise<MediaRow> {
  const n = items.length;
  if (n === 0) throw new AppError("generation_failed", "no clips to assemble", { retryable: false });
  const t = n > 1 ? VIDEO_TRANSITION : 0;
  await ctx.progress.update("rendering", opts.from, { done: 0, total: n });
  const clips: { path: string; durationSec: number }[] = [];
  for (let i = 0; i < n; i++) {
    throwIfAborted(ctx.signal);
    const src = await mediaToLocalFile(items[i]!.clip, ctx.dir);
    const out = path.join(ctx.dir, `norm-${i}.mp4`);
    // Non-final clips get a short tail (last frame held) that the cross-fade consumes,
    // so the result is exactly the planned length.
    const len = items[i]!.durationSec + (i < n - 1 ? t : 0);
    await normalizeClip(src, out, { ...ctx.canvas, durationSec: len }, { signal: ctx.signal });
    clips.push({ path: out, durationSec: len });
    await ctx.progress.update("rendering", opts.from + ((opts.to - opts.from) * 0.8 * (i + 1)) / n, { done: i + 1, total: n });
  }
  const music = await resolveMusic(ctx, opts.musicTrackId);
  const wm = watermarkText(ctx);
  const output = path.join(ctx.dir, "video.mp4");
  await assemble({ clips, output, canvas: ctx.canvas, transitionSec: t, musicPath: music, watermarkText: wm, workDir: ctx.dir }, { signal: ctx.signal });
  await ctx.progress.update("rendering", opts.to, { musicTrackId: music ? (opts.musicTrackId ?? null) : null });
  return storeResultVideo({
    userId: ctx.user.id,
    dreamId: ctx.dream.id,
    jobId: ctx.job.id,
    type: "video",
    file: output,
    dir: ctx.dir,
    model: ctx.videoProvider?.spec.id ?? ctx.job.videoModel ?? "video",
    styleId: ctx.styleId,
    hasWatermark: Boolean(wm),
    isDemo: ctx.job.isDemo || items.some((it) => it.clip.isDemo),
  });
}

// ─── Kinds ──────────────────────────────────────────────────────────────────

async function readyFramesOf(scenes: SceneRow[]): Promise<{ scene: SceneRow; image: MediaRow }[]> {
  const ids = scenes.map((s) => s.currentImageId).filter((x): x is string => Boolean(x));
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(dreamMedia)
    .where(and(inArray(dreamMedia.id, ids), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return scenes.flatMap((s) => {
    const image = s.currentImageId ? byId.get(s.currentImageId) : undefined;
    return image ? [{ scene: s, image }] : [];
  });
}

/** Rebuilds the clip list of the dream's latest video (plan stored on the job that made it). */
async function latestVideoItems(ctx: Ctx): Promise<{ clip: MediaRow; durationSec: number }[] | null> {
  const prev = await latestCompletedJob(ctx.dream.id, "video");
  const plan = prev?.stageDetail?.plan;
  if (!prev || !plan?.length) return null;
  const scenes = await getDb()
    .select()
    .from(dreamScenes)
    .where(inArray(dreamScenes.id, plan.map((p) => p.sceneId)));
  const clipIds = scenes.map((s) => s.currentClipId).filter((x): x is string => Boolean(x));
  if (clipIds.length === 0) return null;
  const clips = await getDb()
    .select()
    .from(dreamMedia)
    .where(and(inArray(dreamMedia.id, clipIds), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)));
  const byId = new Map(clips.map((c) => [c.id, c]));
  const items = plan.flatMap((p) => {
    const scene = scenes.find((s) => s.id === p.sceneId);
    const clip = scene?.currentClipId ? byId.get(scene.currentClipId) : undefined;
    return clip ? [{ clip, durationSec: p.durationSec }] : [];
  });
  return items.length ? items : null;
}

async function runFullSlideshow(ctx: Ctx): Promise<PipelineResult> {
  await ctx.progress.update("preparing_scenes", 5);
  const scenes = ctx.scenes;
  const refs = await ensureReferences(ctx, scenes, { create: true, from: 5, to: 12 });
  throwIfAborted(ctx.signal);
  const frames = await generateFrames(ctx, scenes, refs, { from: 12, to: 70, variant: ctx.job.options.variant ?? 0 });
  throwIfAborted(ctx.signal);
  const result = await renderSlideshow(
    ctx,
    scenes.map((scene, i) => ({ scene, image: frames[i]! })),
    { from: 70, to: 98, musicTrackId: ctx.job.options.musicTrackId },
  );
  return { mediaId: result.id, createdResult: true, coverImageId: frames[0]?.id ?? null, notify: true, durationSec: result.durationSec };
}

async function runFullVideo(ctx: Ctx): Promise<PipelineResult> {
  const provider = ctx.videoProvider!;
  await ctx.progress.update("preparing_scenes", 5);
  let plan = ctx.progress.detail.plan;
  if (!plan?.length) {
    const p = planVideoClips(
      ctx.job.options.targetDurationSec ?? provider.spec.clipDurations[0] ?? 5,
      provider.spec.clipDurations,
      ctx.scenes.map((s) => ({ importance: s.importance })),
    );
    plan = p.clips.map((c) => ({ sceneId: ctx.scenes[c.sceneIndex]!.id, durationSec: c.durationSec }));
    if (plan.length === 0) throw new AppError("generation_failed", "empty clip plan", { retryable: false });
    await ctx.progress.update("preparing_scenes", 6, { plan });
  }
  const selected = plan.map((p) => {
    const scene = ctx.scenes.find((s) => s.id === p.sceneId);
    if (!scene) throw new AppError("generation_failed", "planned scene missing", { retryable: false });
    return scene;
  });
  const refs = await ensureReferences(ctx, selected, { create: true, from: 6, to: 12 });
  throwIfAborted(ctx.signal);
  const variant = ctx.job.options.variant ?? 0;
  const frames = await generateFrames(ctx, selected, refs, { from: 12, to: 40, variant });
  throwIfAborted(ctx.signal);
  const clips = await generateClips(
    ctx,
    selected.map((scene, i) => ({ scene, keyframe: frames[i]!, durationSec: plan![i]!.durationSec })),
    { from: 40, to: 88, variant },
  );
  throwIfAborted(ctx.signal);
  const result = await renderVideo(
    ctx,
    clips.map((clip, i) => ({ clip, durationSec: plan![i]!.durationSec })),
    { from: 88, to: 98, musicTrackId: ctx.job.options.musicTrackId },
  );
  return { mediaId: result.id, createdResult: true, coverImageId: frames[0]?.id ?? null, notify: true, durationSec: result.durationSec };
}

async function sceneOfJob(ctx: Ctx): Promise<SceneRow> {
  const scene = ctx.scenes.find((s) => s.id === ctx.job.sceneId);
  if (!scene) throw new AppError("not_found", "scene to regenerate not found", { retryable: false });
  return scene;
}

/** A fresh variation for each regeneration so seeds and cache keys differ. */
async function regenerationVariant(sceneId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(dreamMedia)
    .where(and(eq(dreamMedia.sceneId, sceneId), eq(dreamMedia.mediaType, "image")));
  return 1000 + (r?.n ?? 0);
}

/** The variation is chosen once and stored on the job — retries reuse it (and the cached asset). */
async function fixedVariant(ctx: Ctx, sceneId: string): Promise<number> {
  if (ctx.progress.detail.variant !== undefined) return ctx.progress.detail.variant;
  const variant = await regenerationVariant(sceneId);
  await ctx.progress.update("preparing_scenes", 6, { variant });
  return variant;
}

/** Music of a previous render: what it actually used, falling back to what it was asked for. */
function inheritedMusic(ctx: Ctx, prevJob: JobRow | undefined): string | null {
  return ctx.job.options.musicTrackId ?? prevJob?.stageDetail?.musicTrackId ?? prevJob?.options.musicTrackId ?? null;
}

async function runSceneImage(ctx: Ctx): Promise<PipelineResult> {
  const scene = await sceneOfJob(ctx);
  await ctx.progress.update("preparing_scenes", 5);
  const refs = await ensureReferences(ctx, [scene], { create: false, from: 5, to: 12 });
  const variant = await fixedVariant(ctx, scene.id);
  const [frame] = await generateFrames(ctx, [scene], refs, { from: 12, to: 70, variant });
  const previous = await latestReadyMedia(ctx.dream.id, "slideshow");
  if (!previous) return { mediaId: frame!.id, createdResult: false, coverImageId: null, notify: false };
  const prevJob = previous.jobId ? (await getDb().select().from(generationJobs).where(eq(generationJobs.id, previous.jobId)))[0] : undefined;
  // Start from exactly the frames of the previous slideshow and swap in the new one —
  // never from per-scene pointers that a video job (other style/variant) may have moved.
  let items: { scene: SceneRow; image: MediaRow }[];
  const prevFrames = prevJob?.stageDetail?.frames;
  if (prevFrames?.length) {
    const rows = await getDb()
      .select()
      .from(dreamMedia)
      .where(and(inArray(dreamMedia.id, prevFrames.map((f) => f.mediaId)), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    items = prevFrames.flatMap((f) => {
      const s = ctx.scenes.find((x) => x.id === f.sceneId);
      if (!s) return [];
      if (s.id === scene.id) return [{ scene: s, image: frame! }];
      const image = byId.get(f.mediaId);
      return image ? [{ scene: s, image }] : [];
    });
  } else {
    items = await readyFramesOf(await loadScenes(ctx.dream.id, ctx.analysisVersion));
  }
  const result = await renderSlideshow(ctx, items, { from: 70, to: 98, musicTrackId: inheritedMusic(ctx, prevJob) });
  return { mediaId: result.id, createdResult: true, coverImageId: null, notify: true, durationSec: result.durationSec };
}

async function runSceneVideo(ctx: Ctx): Promise<PipelineResult> {
  const provider = ctx.videoProvider!;
  const scene = await sceneOfJob(ctx);
  await ctx.progress.update("preparing_scenes", 5);
  const refs = await ensureReferences(ctx, [scene], { create: false, from: 5, to: 12 });
  const variant = await fixedVariant(ctx, scene.id);
  const [frame] = await generateFrames(ctx, [scene], refs, { from: 12, to: 40, variant });
  const prevJob = await latestCompletedJob(ctx.dream.id, "video");
  const planned = prevJob?.stageDetail?.plan?.find((p) => p.sceneId === scene.id)?.durationSec;
  const [oldClip] = scene.currentClipId ? await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, scene.currentClipId)) : [];
  const durationSec = snapDuration(provider.spec, planned ?? oldClip?.durationSec ?? provider.spec.clipDurations[0] ?? 5);
  const [clip] = await generateClips(ctx, [{ scene, keyframe: frame!, durationSec }], { from: 40, to: 88, variant });
  const items = await latestVideoItems(ctx);
  if (!items) return { mediaId: clip!.id, createdResult: false, coverImageId: null, notify: false };
  const result = await renderVideo(ctx, items, { from: 88, to: 98, musicTrackId: inheritedMusic(ctx, prevJob) });
  return { mediaId: result.id, createdResult: true, coverImageId: null, notify: true, durationSec: result.durationSec };
}

async function runRerender(ctx: Ctx): Promise<PipelineResult> {
  await ctx.progress.update("preparing_scenes", 10);
  if (ctx.job.mediaType === "slideshow") {
    const items = await readyFramesOf(ctx.scenes);
    const result = await renderSlideshow(ctx, items, { from: 20, to: 98, musicTrackId: ctx.job.options.musicTrackId });
    return { mediaId: result.id, createdResult: true, coverImageId: null, notify: true, durationSec: result.durationSec };
  }
  const items = await latestVideoItems(ctx);
  if (!items) throw new AppError("generation_failed", "no previous video to re-render", { retryable: false });
  const result = await renderVideo(ctx, items, { from: 20, to: 98, musicTrackId: ctx.job.options.musicTrackId });
  return { mediaId: result.id, createdResult: true, coverImageId: null, notify: true, durationSec: result.durationSec };
}

// ─── Completion / failure ───────────────────────────────────────────────────

async function completeJob(ctx: Ctx, result: PipelineResult): Promise<void> {
  const db = getDb();
  await ctx.progress.drain();
  // Completion and the final charge happen in one transaction: clients never see a
  // completed job that still holds a reservation, and a crash cannot separate the two.
  const done = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.id, ctx.job.id)).for("update");
    if (!job || !(ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)) return null;
    if (job.creditState === "reserved" && job.creditsCost > 0) {
      await applyCreditChange(tx, { userId: job.userId, amount: 0, reservedDelta: -job.creditsCost, type: "capture", jobId: job.id, source: "generation" });
    }
    const [updated] = await tx
      .update(generationJobs)
      .set({
        status: "completed",
        currentStage: "completed",
        progress: 100,
        finishedAt: new Date(),
        resultMediaId: result.mediaId,
        errorCode: null,
        errorMessage: null,
        heartbeatAt: new Date(),
        stageDetail: ctx.progress.detail,
        creditState: job.creditState === "reserved" ? "captured" : job.creditState,
      })
      .where(eq(generationJobs.id, job.id))
      .returning();
    return updated ?? null;
  });
  if (!done) {
    // Cancelled during the last step: credits were already returned, so the result is withdrawn too.
    if (result.createdResult && result.mediaId) await db.update(dreamMedia).set({ status: "deleted", deletedAt: new Date() }).where(eq(dreamMedia.id, result.mediaId));
    throw new JobCancelledError("cancelled before completion");
  }
  if (result.coverImageId) {
    await db
      .update(dreams)
      .set({ coverMediaId: result.coverImageId })
      .where(and(eq(dreams.id, ctx.dream.id), isNull(dreams.coverMediaId)));
  }
  await track("generation_completed", ctx.user.id, {
    format: ctx.job.mediaType,
    kind: ctx.job.kind,
    durationSec: result.durationSec ? Math.round(result.durationSec) : null,
    demo: ctx.job.isDemo,
  });
  if (result.notify) {
    await notifyGenerationCompleted(ctx.job.id).catch((err: Error) => log.warn("completion notification failed", { jobId: ctx.job.id, error: err.message }));
  }
}

/**
 * Final failure: marks the job failed (only if still active), returns the
 * reserved credits / free allowance exactly once and notifies the user.
 */
export async function failGenerationJob(jobId: string, c: Pick<ClassifiedError, "code" | "message">): Promise<boolean> {
  // Status change and refund in one transaction (see finishJobAndRelease).
  const job = await finishJobAndRelease(jobId, { status: "failed", errorCode: c.code, errorMessage: c.message });
  if (!job) return false;
  await track("generation_failed", job.userId, { code: c.code, format: job.mediaType, kind: job.kind });
  await notifyGenerationFailed(jobId, job.releasedCredits > 0 || job.freeReturned).catch((err: Error) => log.warn("failure notification failed", { jobId, error: err.message }));
  return true;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Processes one generation job. Safe to re-run at any point: frames, clips and
 * references are cached by input hash, video tasks resume from their stored
 * provider id, terminal jobs are skipped.
 */
export async function processGeneration(jobId: string, attempt: AttemptInfo): Promise<{ status: string; mediaId?: string | null }> {
  const db = getDb();
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) return { status: "missing" };
  if (TERMINAL.has(job.status)) return { status: job.status };

  const abort = new AbortController();
  const progress = new ProgressReporter(job.id, job, abort);
  let dir: string | undefined;
  const heartbeat = setInterval(() => void progress.heartbeat(), 15_000);
  heartbeat.unref?.();
  try {
    dir = await createJobDir(`gen-${job.id}`);
    await db
      .update(generationJobs)
      .set({ startedAt: job.startedAt ?? new Date(), heartbeatAt: new Date(), retryCount: attempt.attemptsMade })
      .where(eq(generationJobs.id, job.id));
    const ctx = await buildContext(job, dir, abort.signal, progress);
    let result: PipelineResult;
    switch (job.kind) {
      case "full":
        result = job.mediaType === "video" ? await runFullVideo(ctx) : await runFullSlideshow(ctx);
        break;
      case "scene_image":
        result = await runSceneImage(ctx);
        break;
      case "scene_video":
        result = await runSceneVideo(ctx);
        break;
      case "rerender":
        result = await runRerender(ctx);
        break;
    }
    await completeJob(ctx, result);
    log.info("generation completed", { jobId: job.id, kind: job.kind, format: job.mediaType, mediaId: result.mediaId });
    return { status: "completed", mediaId: result.mediaId };
  } catch (err) {
    if (abort.signal.aborted || err instanceof JobCancelledError) {
      log.info("generation stopped (cancelled)", { jobId: job.id });
      return { status: "cancelled" };
    }
    const c = classifyError(err);
    if (c.retryable && !isFinalAttempt(attempt)) {
      log.warn("generation attempt failed, will retry", { jobId: job.id, attempt: attempt.attemptsMade + 1, code: c.code, error: c.message });
      await db
        .update(generationJobs)
        .set({ errorCode: c.code, errorMessage: c.message.slice(0, 1000), retryCount: attempt.attemptsMade + 1 })
        .where(and(eq(generationJobs.id, job.id), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])));
      throw err;
    }
    log.warn("generation failed", { jobId: job.id, code: c.code, error: c.message });
    await failGenerationJob(job.id, c);
    throw new UnrecoverableError(`${c.code}: ${c.message}`);
  } finally {
    clearInterval(heartbeat);
    await progress.drain();
    if (dir) await removeDir(dir);
  }
}
