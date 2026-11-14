import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { GrammyError } from "grammy";
import { getDb } from "../db/client";
import { ACTIVE_JOB_STATUSES, appSettings, dreams, generationJobs, musicTracks, payments, userSettings, users } from "../db/schema";
import { msg } from "../i18n";
import { logger } from "../logger";
import { generateAmbientTrack, probe } from "../media/ffmpeg";
import { enqueue, getQueue, jobIdFor, QUEUES, type SystemPayload } from "../queue";
import { getRedis } from "../redis";
import { applyAudioRetention, purgeAccount, purgeDream } from "../services/account";
import { captureJobCredits, releaseJobCredits } from "../services/credits";
import { duePosts, publishChannelPost } from "../services/channel";
import { userLocale } from "../services/users";
import { getRawSetting, getSettings } from "../settings";
import { keys, uploadFile } from "../storage";
import { botApi, hasBotToken, InlineKeyboard, webAppUrl } from "../telegram/bot-api";
import { sleep } from "../utils";
import { cleanupOldWorkDirs, createJobDir, releaseLock, removeDir, tryLock, type AttemptInfo } from "./common";
import { failGenerationJob } from "./generate";

const log = logger.child({ step: "system" });

const LIVE_STATES = new Set(["waiting", "delayed", "active", "prioritized", "waiting-children", "paused"]);
const MAX_RECOVERIES = 3;

// ─── Generation job reconciliation ──────────────────────────────────────────

/**
 * Makes sure every active generation job in the database has a live BullMQ
 * job. Covers Redis data loss, a crash between DB write and enqueue, and jobs
 * BullMQ gave up on (stalled too often) without the pipeline finalizing them.
 * A job is re-enqueued at most MAX_RECOVERIES times; then it is failed and its
 * credits are returned.
 */
export async function reconcileGenerationJobs(opts: { staleMinutes: number; startup?: boolean }): Promise<{ checked: number; requeued: number; failed: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - opts.staleMinutes * 60_000);
  const conds = [inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])];
  if (!opts.startup) conds.push(or(lt(generationJobs.heartbeatAt, cutoff), and(isNull(generationJobs.heartbeatAt), lt(generationJobs.queuedAt, cutoff)))!);
  const rows = await db
    .select()
    .from(generationJobs)
    .where(and(...conds))
    .limit(500);
  const settings = await getSettings();
  let requeued = 0;
  let failed = 0;
  for (const j of rows) {
    const name = j.mediaType === "video" ? QUEUES.video : QUEUES.slideshow;
    const queue = getQueue(name);
    const bull = await queue.getJob(j.id);
    const state = bull ? await bull.getState() : "missing";
    if (LIVE_STATES.has(state)) continue;
    const redis = getRedis();
    const n = await redis.incr(`reconcile:${j.id}`);
    await redis.expire(`reconcile:${j.id}`, 7 * 86_400);
    if (n > MAX_RECOVERIES) {
      if (await failGenerationJob(j.id, { code: "internal", message: `job lost (BullMQ state: ${state})` })) failed++;
      continue;
    }
    if (bull) await bull.remove().catch(() => undefined);
    await queue.add(name, { jobId: j.id }, { jobId: j.id, attempts: settings.generation.maxAttempts });
    requeued++;
    log.warn("re-enqueued generation job", { jobId: j.id, previousState: state, recovery: n });
  }
  return { checked: rows.length, requeued, failed };
}

/** Dreams stuck in transcribing/analyzing (e.g. Redis lost the job) get one new attempt per hour for 24 h. */
export async function recoverStuckDreams(): Promise<number> {
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select({ id: dreams.id, status: dreams.status })
    .from(dreams)
    .where(
      and(
        inArray(dreams.status, ["transcribing", "analyzing"]),
        isNull(dreams.deletedAt),
        lt(dreams.updatedAt, new Date(now - 15 * 60_000)),
        gt(dreams.updatedAt, new Date(now - 24 * 3600_000)),
      ),
    )
    .limit(200);
  const bucket = Math.floor(now / 3600_000);
  for (const d of rows) {
    if (d.status === "transcribing") {
      await enqueue(QUEUES.transcription, { dreamId: d.id, attempt: bucket }, { jobId: jobIdFor("stt", d.id, "recover", bucket) });
    } else {
      await enqueue(QUEUES.analysis, { dreamId: d.id }, { jobId: jobIdFor("analysis", d.id, "recover", bucket) });
    }
  }
  return rows.length;
}

/**
 * Safety net for credit holds: a finished job must never keep credits
 * reserved (e.g. a process died between finishing the job and settling the
 * credits — in the worker or in the API's cancel path). Completed → capture,
 * failed/cancelled → release. Both operations are idempotent.
 */
export async function healCreditStates(): Promise<{ captured: number; released: number }> {
  const rows = await getDb()
    .select({ id: generationJobs.id, status: generationJobs.status })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.creditState, "reserved"),
        inArray(generationJobs.status, ["completed", "failed", "cancelled"]),
        lt(generationJobs.finishedAt, new Date(Date.now() - 2 * 60_000)),
      ),
    )
    .limit(500);
  let captured = 0;
  let released = 0;
  for (const r of rows) {
    if (r.status === "completed") {
      await captureJobCredits(r.id);
      captured++;
    } else {
      await releaseJobCredits(r.id, `heal:${r.status}`);
      released++;
    }
    log.warn("settled credits of a finished job", { jobId: r.id, status: r.status });
  }
  return { captured, released };
}

export async function expirePendingPayments(): Promise<number> {
  const rows = await getDb()
    .update(payments)
    .set({ status: "expired" })
    .where(and(eq(payments.status, "pending"), lt(payments.createdAt, new Date(Date.now() - 24 * 3600_000))))
    .returning({ id: payments.id });
  return rows.length;
}

export async function runMaintenance(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      out[name] = await fn();
    } catch (err) {
      out[name] = -1;
      log.error("maintenance step failed", { step: name, error: (err as Error).message });
    }
  };
  await step("jobsRequeued", async () => (await reconcileGenerationJobs({ staleMinutes: 10 })).requeued);
  await step("creditsSettled", async () => {
    const r = await healCreditStates();
    return r.captured + r.released;
  });
  await step("dreamsRecovered", recoverStuckDreams);
  await step("audioDeleted", applyAudioRetention);
  await step("postsQueued", async () => {
    const posts = await duePosts();
    for (const p of posts) {
      await enqueue(QUEUES.system, { type: "publish_channel_post", postId: p.id }, { jobId: jobIdFor("publish", p.id, p.scheduledAt?.getTime() ?? 0), attempts: 3 });
    }
    return posts.length;
  });
  await step("paymentsExpired", expirePendingPayments);
  await step("tempDirsRemoved", () => cleanupOldWorkDirs());
  return out;
}

// ─── Morning reminders ──────────────────────────────────────────────────────

const DEFAULT_TZ = "Europe/Moscow";

export function localClock(timeZone: string, now: Date): { date: string; minutes: number } {
  const make = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = make(timeZone);
  } catch {
    fmt = make(DEFAULT_TZ);
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

/** True when `now` (local minutes) is within `windowMin` after the configured HH:MM. */
export function isReminderDue(reminderTime: string, localMinutes: number, windowMin = 10): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(reminderTime);
  if (!m) return false;
  const target = Number(m[1]) * 60 + Number(m[2]);
  const diff = (localMinutes - target + 1440) % 1440;
  return diff < windowMin;
}

/**
 * Sends the optional morning reminder ("Remember what you dreamed?") to users
 * who enabled it, once per local day. Runs every 5 minutes; the 10-minute
 * window tolerates scheduler jitter, `last_reminded_on` prevents duplicates.
 */
export async function runReminders(now = new Date()): Promise<number> {
  if (!hasBotToken()) return 0;
  const db = getDb();
  const rows = await db
    .select({ user: users, timezone: userSettings.timezone, notifications: userSettings.notifications })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(users.status, "active"), eq(users.botChatAvailable, true), sql`(${userSettings.notifications}->>'reminders')::boolean = true`));
  let sent = 0;
  for (const r of rows) {
    const clock = localClock(r.timezone || DEFAULT_TZ, now);
    if (!isReminderDue(r.notifications.reminderTime, clock.minutes)) continue;
    if (r.user.lastRemindedOn === clock.date) continue;
    // Claim the reminder for today first (another replica may run the same scheduler tick).
    const claimed = await db
      .update(users)
      .set({ lastRemindedOn: clock.date })
      .where(and(eq(users.id, r.user.id), or(isNull(users.lastRemindedOn), sql`${users.lastRemindedOn} <> ${clock.date}`)))
      .returning({ id: users.id });
    if (claimed.length === 0) continue;
    const m = msg(userLocale(r.user));
    try {
      await botApi().sendMessage(r.user.telegramId, m.reminder, { reply_markup: new InlineKeyboard().webApp(m.btnRecord, webAppUrl("/")) });
      sent++;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) {
        await db.update(users).set({ botChatAvailable: false }).where(eq(users.id, r.user.id));
      } else {
        log.warn("reminder failed", { error: (err as Error).message });
      }
    }
    await sleep(40); // stay well under Telegram's broadcast limits
  }
  return sent;
}

// ─── Generated music library ────────────────────────────────────────────────

const MUSIC_SEEDED_KEY = "internal.music_seeded";

async function markMusicSeeded(): Promise<void> {
  await getDb().insert(appSettings).values({ key: MUSIC_SEEDED_KEY, value: true }).onConflictDoNothing();
}

const GENERATED_TRACKS = [
  { title: "Лунный туман", variant: 0 },
  { title: "Глубина", variant: 1 },
  { title: "Северное сияние", variant: 2 },
];

/** Creates the royalty-free generated ambient tracks once (first start of a fresh install). */
export async function seedGeneratedMusic(): Promise<number> {
  const db = getDb();
  // Seed once per installation: tracks an admin deleted must not come back.
  if (await getRawSetting(MUSIC_SEEDED_KEY, db)) return 0;
  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(musicTracks)
    .where(and(eq(musicTracks.isGenerated, true), isNull(musicTracks.ownerUserId)));
  if ((existing?.n ?? 0) > 0) {
    await markMusicSeeded();
    return 0;
  }
  const owner = `seed-music:${process.pid}`;
  if (!(await tryLock("lock:seed-music", owner, 10 * 60_000))) return 0;
  const dir = await createJobDir("music");
  try {
    let created = 0;
    for (const [i, t] of GENERATED_TRACKS.entries()) {
      const id = randomUUID();
      const file = path.join(dir, `${id}.mp3`);
      await generateAmbientTrack(file, t.variant, 120);
      const info = await probe(file);
      const storageKey = keys.libraryMusic(id, "mp3");
      await uploadFile(storageKey, file, "audio/mpeg");
      await db.insert(musicTracks).values({
        id,
        ownerUserId: null,
        title: t.title,
        artist: "DREAM AI",
        license: "Generated by DREAM AI (royalty-free)",
        storageKey,
        durationSec: Math.round(info.durationSec * 10) / 10,
        isGenerated: true,
        isActive: true,
        sortOrder: i,
      });
      created++;
    }
    await markMusicSeeded();
    log.info("generated music library seeded", { created });
    return created;
  } finally {
    await releaseLock("lock:seed-music", owner);
    await removeDir(dir);
  }
}

// ─── System queue processor ─────────────────────────────────────────────────

export async function processSystem(payload: SystemPayload, _attempt: AttemptInfo): Promise<unknown> {
  switch (payload.type) {
    case "delete_account":
      return purgeAccount(payload.userId, payload.telegramId);
    case "purge_dream":
      return purgeDream(payload.userId, payload.dreamId);
    case "publish_channel_post":
      await publishChannelPost(payload.postId);
      return { published: payload.postId };
    case "maintenance":
      return runMaintenance();
    case "reminders":
      return { sent: await runReminders() };
    case "seed_music":
      return { created: await seedGeneratedMusic() };
  }
}
