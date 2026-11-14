import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { env } from "../env";
import { hitRateLimit } from "../redis";
import { getDb, type DbOrTx } from "../db/client";
import { dreamMedia, dreamScenes, dreams, generationJobs } from "../db/schema";
import { ACTIVE_JOB_STATUSES } from "../db/schema";
import type { DreamDetailDto, JobDto, MediaDto } from "../dto";
import { AppError } from "../errors";
import { enqueue, jobIdFor, QUEUES } from "../queue";
import { getSettings } from "../settings";
import { keys, putObject, signMediaUrl } from "../storage";
import { sanitizeUserText, sha256, startOfUtcDay } from "../utils";
import { track } from "./analytics";
import { cancelJobAndRelease } from "./credits";
import { cancelPostsForDream } from "./channel";
import { getMediaByIds, mediaDto, type MediaRow } from "./media";
import type { UserRow } from "./users";
import { assertActive } from "./users";

export type DreamRow = typeof dreams.$inferSelect;
type DreamSource = DreamRow["source"];

export const MIN_DREAM_TEXT = 15;

// ─── Audio validation ───────────────────────────────────────────────────────

const AUDIO_SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: "webm", mime: "audio/webm", test: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
  { ext: "ogg", mime: "audio/ogg", test: (b) => b.subarray(0, 4).toString("ascii") === "OggS" },
  { ext: "m4a", mime: "audio/mp4", test: (b) => b.subarray(4, 8).toString("ascii") === "ftyp" },
  { ext: "wav", mime: "audio/wav", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE" },
  { ext: "flac", mime: "audio/flac", test: (b) => b.subarray(0, 4).toString("ascii") === "fLaC" },
  { ext: "mp3", mime: "audio/mpeg", test: (b) => b.subarray(0, 3).toString("ascii") === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0) },
  { ext: "aac", mime: "audio/aac", test: (b) => b[0] === 0xff && (b[1]! & 0xf6) === 0xf0 },
];

/** Detects the container from magic bytes — the client-declared MIME type is not trusted. */
export function detectAudioFormat(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length < 12) return null;
  const hit = AUDIO_SIGNATURES.find((s) => s.test(bytes));
  return hit ? { ext: hit.ext, mime: hit.mime } : null;
}

export function validateAudioUpload(bytes: Buffer): { ext: string; mime: string } {
  if (bytes.length === 0) throw new AppError("audio_empty", "Empty recording");
  if (bytes.length > env().MAX_AUDIO_BYTES) throw new AppError("audio_too_large", "Recording too large");
  if (bytes.length < 1500) throw new AppError("audio_empty", "Recording too short");
  const fmt = detectAudioFormat(bytes);
  if (!fmt) throw new AppError("audio_unsupported", "Unsupported audio format");
  return fmt;
}

export function normalizeDreamText(text: string): string {
  const clean = sanitizeUserText(text);
  if (clean.length < MIN_DREAM_TEXT) throw new AppError("text_too_short", "Dream text too short");
  if (clean.length > env().MAX_DREAM_TEXT_CHARS) throw new AppError("text_too_long", "Dream text too long", { details: { max: env().MAX_DREAM_TEXT_CHARS } });
  return clean;
}

async function assertDailyDreamLimit(userId: string, db: DbOrTx): Promise<void> {
  const { limits } = await getSettings();
  const [r] = await db.select({ n: count() }).from(dreams).where(and(eq(dreams.userId, userId), gte(dreams.createdAt, startOfUtcDay())));
  if ((r?.n ?? 0) >= limits.maxDreamsPerDay) throw new AppError("rate_limited", "Daily dream limit reached");
}

// ─── Ownership ──────────────────────────────────────────────────────────────

/** Loads a dream only if it belongs to the user (server-side ownership check). */
export async function getOwnedDream(userId: string, dreamId: string, db: DbOrTx = getDb()): Promise<DreamRow> {
  const [d] = await db
    .select()
    .from(dreams)
    .where(and(eq(dreams.id, dreamId), eq(dreams.userId, userId), isNull(dreams.deletedAt)));
  if (!d) throw new AppError("not_found", "Dream not found");
  return d;
}

// ─── Creation ───────────────────────────────────────────────────────────────

export async function createVoiceDream(user: UserRow, audio: Buffer, opts: { source: DreamSource; replyChatId?: number; durationHintSec?: number }): Promise<DreamRow> {
  assertActive(user);
  const db = getDb();
  await assertDailyDreamLimit(user.id, db);
  const fmt = validateAudioUpload(audio);
  if (opts.durationHintSec && opts.durationHintSec > env().MAX_AUDIO_SECONDS) throw new AppError("audio_too_long", "Recording too long");
  const [dream] = await db.insert(dreams).values({ userId: user.id, status: "transcribing", source: opts.source, audioMime: fmt.mime, audioDurationSec: opts.durationHintSec }).returning();
  const key = keys.audio(user.id, dream!.id, fmt.ext);
  try {
    await putObject(key, audio, fmt.mime);
  } catch (err) {
    await db.delete(dreams).where(eq(dreams.id, dream!.id));
    throw err;
  }
  const [updated] = await db.update(dreams).set({ originalAudioKey: key }).where(eq(dreams.id, dream!.id)).returning();
  await enqueue(QUEUES.transcription, { dreamId: dream!.id, replyChatId: opts.replyChatId, attempt: 1 }, { jobId: jobIdFor("stt", dream!.id, 1) });
  await track("dream_created", user.id, { source: opts.source });
  return updated!;
}

/** Re-record: replaces the audio of an existing dream and transcribes again. */
export async function replaceDreamAudio(user: UserRow, dreamId: string, audio: Buffer, durationHintSec?: number): Promise<DreamRow> {
  assertActive(user);
  const db = getDb();
  const dream = await getOwnedDream(user.id, dreamId, db);
  if (dream.status === "transcribing" || dream.status === "analyzing") throw new AppError("conflict", "Dream is being processed");
  const fmt = validateAudioUpload(audio);
  if (durationHintSec && durationHintSec > env().MAX_AUDIO_SECONDS) throw new AppError("audio_too_long", "Recording too long");
  // Every re-record is a paid transcription — cap it like new dreams.
  const { limits } = await getSettings();
  const rl = await hitRateLimit(`rerecord:${user.id}`, limits.maxDreamsPerDay * 2, 86_400);
  if (!rl.allowed) throw new AppError("rate_limited", "Daily recording limit reached");
  const key = keys.audio(user.id, dream.id, fmt.ext);
  await putObject(key, audio, fmt.mime);
  const oldKey = dream.originalAudioKey;
  const attempt = Date.now();
  const [updated] = await db
    .update(dreams)
    .set({ originalAudioKey: key, audioMime: fmt.mime, audioDurationSec: durationHintSec, audioDeletedAt: null, status: "transcribing", errorCode: null })
    .where(eq(dreams.id, dream.id))
    .returning();
  if (oldKey && oldKey !== key) {
    const { deleteObjects } = await import("../storage");
    await deleteObjects([oldKey]).catch(() => undefined);
  }
  await enqueue(QUEUES.transcription, { dreamId: dream.id, attempt }, { jobId: jobIdFor("stt", dream.id, attempt) });
  return updated!;
}

/**
 * Text dream. `confirm` = the user already reviewed the text (typed it
 * themselves) — analysis starts right away.
 */
export async function createTextDream(user: UserRow, text: string, opts: { source: DreamSource; confirm: boolean; replyChatId?: number }): Promise<DreamRow> {
  assertActive(user);
  const db = getDb();
  await assertDailyDreamLimit(user.id, db);
  const clean = normalizeDreamText(text);
  // Check the analysis budget before creating anything, so a rejected request leaves no draft behind.
  if (opts.confirm) await consumeAnalysisBudget(user.id);
  const [dream] = await db
    .insert(dreams)
    .values({ userId: user.id, status: opts.confirm ? "analyzing" : "review", source: opts.source, originalText: clean, editedText: clean })
    .returning();
  await track("dream_created", user.id, { source: opts.source });
  if (opts.confirm) await enqueueAnalysis(dream!, opts.replyChatId);
  return dream!;
}

async function consumeAnalysisBudget(userId: string): Promise<void> {
  const { limits } = await getSettings();
  const rl = await hitRateLimit(`analysis:${userId}`, limits.maxAnalysesPerDay, 86_400);
  if (!rl.allowed) throw new AppError("rate_limited", "Daily analysis limit reached");
}

async function enqueueAnalysis(dream: DreamRow, replyChatId?: number): Promise<void> {
  const hash = sha256(dream.editedText ?? "").slice(0, 12);
  await enqueue(QUEUES.analysis, { dreamId: dream.id, replyChatId }, { jobId: jobIdFor("analysis", dream.id, hash, Date.now()) });
}

export async function updateDreamText(user: UserRow, dreamId: string, text: string): Promise<DreamRow> {
  const db = getDb();
  const dream = await getOwnedDream(user.id, dreamId, db);
  if (dream.status === "transcribing" || dream.status === "analyzing") throw new AppError("conflict", "Dream is being processed");
  const clean = normalizeDreamText(text);
  const [updated] = await db.update(dreams).set({ editedText: clean }).where(eq(dreams.id, dream.id)).returning();
  return updated!;
}

/** Confirms the (possibly edited) text and starts story analysis if the text changed. */
export async function confirmDream(user: UserRow, dreamId: string, text?: string): Promise<DreamRow> {
  assertActive(user);
  const db = getDb();
  let dream = await getOwnedDream(user.id, dreamId, db);
  if (dream.status === "transcribing") throw new AppError("dream_not_ready", "Transcription in progress");
  if (dream.status === "analyzing") return dream;
  const clean = normalizeDreamText(text ?? dream.editedText ?? "");
  const hash = sha256(clean);
  if (dream.status === "ready" && dream.analysisTextHash === hash) return dream;
  // Re-analysis replaces the scenes — not while a generation is working with them.
  const [running] = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.dreamId, dream.id), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])))
    .limit(1);
  if (running) throw new AppError("job_already_running", "Wait for the current generation to finish");
  await consumeAnalysisBudget(user.id);
  const [updated] = await db.update(dreams).set({ editedText: clean, status: "analyzing", errorCode: null }).where(eq(dreams.id, dream.id)).returning();
  dream = updated!;
  await enqueueAnalysis(dream);
  return dream;
}

export async function renameDream(user: UserRow, dreamId: string, title: string): Promise<void> {
  const clean = sanitizeUserText(title).replace(/\n/g, " ").slice(0, 80);
  if (clean.length < 1) throw new AppError("validation_failed", "Title required");
  await getOwnedDream(user.id, dreamId);
  await getDb().update(dreams).set({ title: clean, titleEditedByUser: true }).where(eq(dreams.id, dreamId));
}

export async function setFavorite(user: UserRow, dreamId: string, isFavorite: boolean): Promise<void> {
  await getOwnedDream(user.id, dreamId);
  await getDb().update(dreams).set({ isFavorite }).where(eq(dreams.id, dreamId));
}

export async function setPublicationConsent(user: UserRow, dreamId: string, consent: boolean): Promise<void> {
  await getOwnedDream(user.id, dreamId);
  await getDb()
    .update(dreams)
    .set({ publicationConsentAt: consent ? new Date() : null })
    .where(eq(dreams.id, dreamId));
  // Withdrawn consent stops every post that hasn't been published yet.
  if (!consent) await cancelPostsForDream(dreamId, "consent_withdrawn");
}

/**
 * Deletes a dream: hidden immediately, then files and rows are purged by the
 * worker. Active generation jobs are cancelled (and their credits released).
 */
export async function deleteDream(user: UserRow, dreamId: string): Promise<void> {
  const db = getDb();
  await getOwnedDream(user.id, dreamId, db);
  await db.update(dreams).set({ deletedAt: new Date() }).where(eq(dreams.id, dreamId));
  // Running generations are cancelled and their reserved credits returned right away.
  const active = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.dreamId, dreamId), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])));
  for (const j of active) await cancelJobAndRelease(j.id, "dream_deleted", { userId: user.id });
  await cancelPostsForDream(dreamId, "dream_deleted");
  // Files are purged after a short delay so uploads still in flight from a just-cancelled job
  // are removed too (an optional longer recovery window comes from retention.deletedPurgeDays).
  const { retention } = await getSettings();
  const delay = Math.max(10 * 60_000, retention.deletedPurgeDays * 86_400_000);
  await enqueue(QUEUES.system, { type: "purge_dream", dreamId, userId: user.id }, { jobId: jobIdFor("purge", dreamId), attempts: 8, delay });
}

// ─── Detail DTO ─────────────────────────────────────────────────────────────

export function jobDto(j: typeof generationJobs.$inferSelect, media: Map<string, MediaRow>): JobDto {
  const previews = (j.stageDetail?.previewMediaIds ?? [])
    .map((id) => media.get(id))
    .filter((m): m is MediaRow => Boolean(m))
    .map(mediaDto);
  return {
    id: j.id,
    dreamId: j.dreamId,
    mediaType: j.mediaType,
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    stage: j.currentStage,
    stageDone: j.stageDetail?.done ?? null,
    stageTotal: j.stageDetail?.total ?? null,
    previews,
    errorCode: j.errorCode,
    creditsCost: j.creditsCost,
    creditState: j.creditState,
    usedFreeAllowance: j.usedFreeAllowance,
    isDemo: j.isDemo,
    resultMediaId: j.resultMediaId,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

export async function getDreamDetail(user: UserRow, dreamId: string): Promise<DreamDetailDto> {
  const db = getDb();
  const dream = await getOwnedDream(user.id, dreamId, db);
  const [scenes, media, jobs] = await Promise.all([
    db
      .select()
      .from(dreamScenes)
      .where(and(eq(dreamScenes.dreamId, dream.id), eq(dreamScenes.analysisVersion, dream.analysisVersion)))
      .orderBy(asc(dreamScenes.sequenceNumber)),
    db
      .select()
      .from(dreamMedia)
      .where(and(eq(dreamMedia.dreamId, dream.id), isNull(dreamMedia.deletedAt)))
      .orderBy(desc(dreamMedia.createdAt)),
    db.select().from(generationJobs).where(eq(generationJobs.dreamId, dream.id)).orderBy(desc(generationJobs.createdAt)).limit(20),
  ]);
  const byId = new Map(media.map((m) => [m.id, m]));
  const previewIds = jobs.flatMap((j) => j.stageDetail?.previewMediaIds ?? []);
  const missing = previewIds.filter((id) => !byId.has(id));
  if (missing.length) for (const [k, v] of await getMediaByIds(missing, db)) byId.set(k, v);
  const ready = (t: MediaRow["mediaType"]) => media.filter((m) => m.mediaType === t && m.status === "ready").map(mediaDto);
  const active = jobs.filter((j) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status));
  // Only the most recent full generation counts: a later success hides an earlier failure.
  const latestFull = jobs.find((j) => j.kind === "full");
  const lastFailed = latestFull?.status === "failed" ? latestFull : undefined;
  const cover = dream.coverMediaId ? byId.get(dream.coverMediaId) : undefined;
  const preview = media.find((m) => m.mediaType === "image" && m.status === "ready" && m.jobId === null);
  const bible = dream.bible;
  return {
    id: dream.id,
    title: dream.title,
    summary: dream.summary,
    status: dream.status,
    source: dream.source,
    originalText: dream.originalText,
    editedText: dream.editedText,
    language: dream.language,
    atmosphere: dream.atmosphere,
    visualStyle: dream.visualStyle,
    createdAt: dream.createdAt.toISOString(),
    updatedAt: dream.updatedAt.toISOString(),
    isFavorite: dream.isFavorite,
    hasAudio: Boolean(dream.originalAudioKey && !dream.audioDeletedAt),
    audioUrl: dream.originalAudioKey && !dream.audioDeletedAt ? signMediaUrl(`audio-${dream.id}`) : null,
    audioDurationSec: dream.audioDurationSec,
    transcriptionIsDemo: dream.transcriptionIsDemo,
    analysisIsDemo: dream.analysisIsDemo,
    publicationConsent: Boolean(dream.publicationConsentAt),
    errorCode: dream.errorCode,
    characters: (bible?.characters ?? []).map((c) => ({ key: c.key, name: c.name, role: c.role, visualTag: c.visualTag })),
    locations: (bible?.locations ?? []).map((l) => ({ key: l.key, name: l.name, description: l.description })),
    scenes: scenes.map((s) => {
      const img = s.currentImageId ? byId.get(s.currentImageId) : undefined;
      const clip = s.currentClipId ? byId.get(s.currentClipId) : undefined;
      return {
        id: s.id,
        sequenceNumber: s.sequenceNumber,
        title: s.title,
        description: s.description,
        cameraAngle: s.cameraAngle,
        motion: s.motion,
        mood: s.mood,
        characters: s.characters,
        location: s.location,
        durationSec: s.durationSec,
        status: s.status,
        image: img && img.status === "ready" ? mediaDto(img) : null,
        clip: clip && clip.status === "ready" ? mediaDto(clip) : null,
      };
    }),
    slideshows: ready("slideshow"),
    videos: ready("video"),
    activeJobs: active.map((j) => jobDto(j, byId)),
    lastFailedJob: lastFailed && !active.some((a) => a.mediaType === lastFailed.mediaType) ? jobDto(lastFailed, byId) : null,
    cover: cover && cover.status === "ready" ? mediaDto(cover) : null,
    preview: preview ? (mediaDto(preview) as MediaDto) : null,
  };
}
