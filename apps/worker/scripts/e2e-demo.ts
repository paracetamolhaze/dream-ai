/**
 * End-to-end check of the generation worker in DEMO MODE against real
 * Postgres / Redis / S3 (docker compose). Spawns the *built* worker
 * (apps/worker/dist/index.js), drives the pipeline through core services and
 * asserts on database + storage state, including a kill/restart mid-video.
 *
 *   npm run build -w @dream/worker
 *   npx tsx --env-file=.env apps/worker/scripts/e2e-demo.ts
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { findVideoModel } from "@dream/core/ai/models";
import type { VideoProvider } from "@dream/core/ai/types";
import { closeDb, getDb } from "@dream/core/db/client";
import { aiUsage, creditTransactions, dreamMedia, dreamScenes, dreams, generationJobs, musicTracks, users } from "@dream/core/db/schema";
import { AppError } from "@dream/core/errors";
import { probe } from "@dream/core/media/ffmpeg";
import { JobCancelledError } from "@dream/core/pipeline/common";
import { ensureClip } from "@dream/core/pipeline/generate";
import { closeQueues, getQueue, QUEUES } from "@dream/core/queue";
import { closeRedis } from "@dream/core/redis";
import { requestAccountDeletion } from "@dream/core/services/account";
import { grantCredits, releaseJobCredits } from "@dream/core/services/credits";
import { confirmDream, createVoiceDream } from "@dream/core/services/dreams";
import { cancelJob, getQuote, startGeneration } from "@dream/core/services/generation";
import { getUser, upsertTelegramUser } from "@dream/core/services/users";
import { getSettings, invalidateSettingsCache, updateSettings } from "@dream/core/settings";
import { headObject } from "@dream/core/storage";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const workerEntry = path.join(repoRoot, "apps/worker/dist/index.js");

let failures = 0;
const results: string[] = [];
function check(cond: unknown, label: string): void {
  const line = `${cond ? "PASS" : "FAIL"}  ${label}`;
  results.push(line);
  console.log(line);
  if (!cond) failures++;
}
const log = (...a: unknown[]) => console.log("[e2e]", ...a);

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 300_000, everyMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// ─── worker process control ─────────────────────────────────────────────────

let worker: ChildProcess | null = null;
function startWorker(tag: string): void {
  worker = spawn(process.execPath, [`--env-file=${path.join(repoRoot, ".env")}`, workerEntry], { cwd: path.join(repoRoot, "apps/worker"), stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `[worker:${tag}]`;
  const forward = (buf: Buffer) => {
    for (const line of buf.toString().split("\n")) {
      if (!line.trim()) continue;
      if (/"level":"(warn|error)"/.test(line) || /generation completed|workers started|resuming video task|re-enqueued|cancelled/.test(line)) console.log(prefix, line.slice(0, 400));
    }
  };
  worker.stdout?.on("data", forward);
  worker.stderr?.on("data", forward);
  log(`worker ${tag} started (pid ${worker.pid})`);
}
async function killWorker(): Promise<void> {
  if (!worker) return;
  const w = worker;
  worker = null;
  await new Promise<void>((resolve) => {
    w.once("exit", () => resolve());
    w.kill("SIGKILL");
  });
  log("worker killed");
}

// ─── helpers ────────────────────────────────────────────────────────────────

const db = () => getDb();
async function job(id: string) {
  const [j] = await db().select().from(generationJobs).where(eq(generationJobs.id, id));
  return j!;
}
async function waitJob(id: string, timeoutMs = 600_000) {
  return waitFor(`job ${id}`, async () => {
    const j = await job(id);
    return j.status === "completed" || j.status === "failed" || j.status === "cancelled" ? j : null;
  }, timeoutMs, 1500);
}
async function ledger(jobId: string) {
  return db().select().from(creditTransactions).where(eq(creditTransactions.jobId, jobId));
}
function ffmpegGen(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

const DREAM_TEXT =
  "Мне приснилось, что я был в огромном заброшенном городе. Небо было красным, а улицы совершенно пустыми. " +
  "Я долго шёл по широкому проспекту и встретил человека без лица в длинном сером пальто. " +
  "Он молча показал мне дверь в другое измерение, светящуюся холодным синим светом. " +
  "Я открыл дверь и оказался на берегу ночного океана, где стоял маленький синий дом. Потом я проснулся.";

async function main(): Promise<void> {
  const settings = await getSettings({ fresh: true });
  const originalModels = structuredClone(settings.models);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "dream-e2e-"));
  startWorker("A");

  // User with credits
  const tgId = 700_000_000 + Math.floor(Math.random() * 99_999_999);
  const { user } = await upsertTelegramUser({ id: tgId, first_name: "E2E", language_code: "ru" });
  await grantCredits({ userId: user.id, amount: 500, type: "admin_grant", note: "e2e" });
  log("user", user.id, "telegram", tgId);

  // ── 1. Voice → transcription (demo STT) ──
  const ogg = path.join(tmp, "voice.ogg");
  ffmpegGen(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", "-b:a", "48k", ogg]);
  let u = await getUser(user.id);
  const dream = await createVoiceDream(u, await readFile(ogg), { source: "miniapp_voice", durationHintSec: 3 });
  const reviewed = await waitFor("transcription", async () => {
    const [d] = await db().select().from(dreams).where(eq(dreams.id, dream.id));
    if (d?.status === "transcription_failed") throw new Error(`transcription failed: ${d.errorCode}`);
    return d?.status === "review" ? d : null;
  }, 120_000);
  check(reviewed.status === "review" && reviewed.transcriptionIsDemo && (reviewed.editedText ?? "").includes("ДЕМО"), "voice dream transcribed (demo STT, labelled) → status review");
  check(reviewed.audioDurationSec !== null && Math.abs((reviewed.audioDurationSec ?? 0) - 3) < 0.5, `audio duration measured (${reviewed.audioDurationSec}s)`);

  // ── 1b. Silent recording is rejected before paying for STT ──
  const wav = path.join(tmp, "silent.wav");
  ffmpegGen(["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", "-c:a", "pcm_s16le", wav]);
  const silent = await createVoiceDream(u, await readFile(wav), { source: "miniapp_voice", durationHintSec: 2 });
  const silentDone = await waitFor("silent transcription", async () => {
    const [d] = await db().select().from(dreams).where(eq(dreams.id, silent.id));
    return d && d.status !== "transcribing" ? d : null;
  }, 120_000);
  check(silentDone.status === "transcription_failed" && silentDone.errorCode === "audio_empty", `silent recording → transcription_failed (${silentDone.errorCode})`);

  // ── 2. Confirm text → analysis (demo LLM) ──
  await confirmDream(u, dream.id, DREAM_TEXT);
  const ready = await waitFor("analysis", async () => {
    const [d] = await db().select().from(dreams).where(eq(dreams.id, dream.id));
    if (d?.status === "analysis_failed") throw new Error(`analysis failed: ${d.errorCode}`);
    return d?.status === "ready" ? d : null;
  }, 120_000);
  const scenes = await db().select().from(dreamScenes).where(and(eq(dreamScenes.dreamId, dream.id), eq(dreamScenes.analysisVersion, ready.analysisVersion)));
  check(ready.analysisVersion === 1 && scenes.length >= 1 && scenes.length <= settings.generation.slideshowMaxScenes, `analysis ready: v${ready.analysisVersion}, ${scenes.length} scenes, title «${ready.title}»`);
  check(Boolean(ready.bible?.seed) && (ready.bible?.characters.some((c) => c.key === "dreamer") ?? false), "bible built (seed, first-person dreamer character)");

  // ── 3. Free preview frame becomes the cover ──
  const withCover = await waitFor("preview cover", async () => {
    const [d] = await db().select().from(dreams).where(eq(dreams.id, dream.id));
    return d?.coverMediaId ? d : null;
  }, 90_000);
  check(Boolean(withCover.coverMediaId), "free preview frame generated and set as cover");

  // Generated music library (seeded by the worker on start)
  const tracks = await waitFor("music seed", async () => {
    const rows = await db().select().from(musicTracks).where(eq(musicTracks.isGenerated, true));
    return rows.length >= 3 ? rows : null;
  }, 180_000, 2000);
  check(tracks.length >= 3, `generated ambient music seeded (${tracks.map((t) => t.title).join(", ")})`);

  // ── 4. Slideshow (first one is free) ──
  u = await getUser(user.id);
  const quote = await getQuote(u, dream.id, "ru");
  log("quote", JSON.stringify({ slideshow: quote.slideshow, video: quote.video.options, demo: quote.demo }));
  const idem = randomUUID();
  const sJob = await startGeneration(u, dream.id, { format: "slideshow", styleId: ready.visualStyle ?? "cinematic", musicTrackId: tracks[0]!.id, idempotencyKey: idem, locale: "ru" });
  const sAgain = await startGeneration(u, dream.id, { format: "slideshow", styleId: ready.visualStyle ?? "cinematic", musicTrackId: tracks[0]!.id, idempotencyKey: idem, locale: "ru" });
  check(sAgain.id === sJob.id, "same idempotency key → same job");
  let duplicateBlocked = false;
  try {
    await startGeneration(u, dream.id, { format: "slideshow", styleId: "anime", idempotencyKey: randomUUID(), locale: "ru" });
  } catch (err) {
    duplicateBlocked = err instanceof AppError && err.code === "job_already_running";
  }
  check(duplicateBlocked, "second active slideshow for the same dream is rejected (job_already_running)");
  const sDone = await waitJob(sJob.id);
  check(sDone.status === "completed" && sDone.progress === 100, `slideshow job completed (status ${sDone.status}, error ${sDone.errorCode ?? "-"})`);
  check(sDone.usedFreeAllowance && sDone.creditsCost === 0 && sDone.creditState === "captured", `free allowance used and captured (creditState ${sDone.creditState})`);
  const [sMedia] = sDone.resultMediaId ? await db().select().from(dreamMedia).where(eq(dreamMedia.id, sDone.resultMediaId)) : [];
  const sHead = sMedia?.storageKey ? await headObject(sMedia.storageKey) : null;
  check(Boolean(sMedia && sHead && sHead.size > 10_000 && sMedia.thumbnailKey), `slideshow MP4 in storage (${sHead?.size ?? 0} bytes, ${sMedia?.durationSec}s, ${sMedia?.width}x${sMedia?.height}, watermark=${sMedia?.hasWatermark})`);
  const expectedSlideSec = scenes.length * settings.generation.slideshowSecondsPerScene;
  check(sMedia?.durationSec != null && Math.abs(sMedia.durationSec - expectedSlideSec) < 0.6, `slideshow duration ${sMedia?.durationSec}s ≈ ${expectedSlideSec}s`);
  const slideFrames = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, sJob.id), eq(dreamMedia.mediaType, "image")));
  check(slideFrames.length === scenes.length - 1, `preview frame reused by the slideshow (${slideFrames.length} new frames for ${scenes.length} scenes)`);

  // ── 5. Video (paid): reserve → capture ──
  u = await getUser(user.id);
  const balanceBefore = u.creditsBalance;
  const vq = await getQuote(u, dream.id, "ru");
  const option = vq.video.options[0];
  if (!option) throw new Error("no video duration option offered");
  const vJob = await startGeneration(u, dream.id, { format: "video", styleId: ready.visualStyle ?? "cinematic", targetDurationSec: option.actualSec, idempotencyKey: randomUUID(), locale: "ru" });
  u = await getUser(user.id);
  check(u.creditsBalance === balanceBefore - vJob.creditsCost && u.creditsReserved === vJob.creditsCost && vJob.creditsCost > 0, `video credits reserved (${vJob.creditsCost} cr, balance ${balanceBefore} → ${u.creditsBalance})`);
  const vDone = await waitJob(vJob.id);
  check(vDone.status === "completed", `video job completed (status ${vDone.status}, error ${vDone.errorCode ?? "-"}: ${vDone.errorMessage ?? ""})`);
  u = await getUser(user.id);
  const vLedger = await ledger(vJob.id);
  check(
    u.creditsReserved === 0 && u.creditsBalance === balanceBefore - vJob.creditsCost && vDone.creditState === "captured" && vLedger.filter((t) => t.type === "reserve").length === 1 && vLedger.filter((t) => t.type === "capture").length === 1,
    `video credits captured once (ledger: ${vLedger.map((t) => `${t.type}:${t.amount}`).join(", ")})`,
  );
  const [vMedia] = vDone.resultMediaId ? await db().select().from(dreamMedia).where(eq(dreamMedia.id, vDone.resultMediaId)) : [];
  const vHead = vMedia?.storageKey ? await headObject(vMedia.storageKey) : null;
  check(Boolean(vMedia && vHead && vHead.size > 10_000), `video MP4 in storage (${vHead?.size ?? 0} bytes, ${vMedia?.durationSec}s)`);
  check(vMedia?.durationSec != null && Math.abs(vMedia.durationSec - option.actualSec) < 0.6, `video duration ${vMedia?.durationSec}s ≈ offered ${option.actualSec}s`);
  const vFrames = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, vJob.id), eq(dreamMedia.mediaType, "image")));
  check(vFrames.length === 0, `video reused the slideshow keyframes (new frames: ${vFrames.length})`);
  const [{ n: resultsCount } = { n: 0 }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(dreamMedia)
    .where(and(eq(dreamMedia.dreamId, dream.id), sql`${dreamMedia.mediaType} in ('slideshow','video')`, eq(dreamMedia.status, "ready")));
  const [{ n: dreamRows } = { n: 0 }] = await db().select({ n: sql<number>`count(*)::int` }).from(dreams).where(eq(dreams.id, dream.id));
  check(resultsCount === 2 && dreamRows === 1, "one dream row with two linked results (slideshow + video)");

  // ── 6. Forced failure → credits released exactly once ──
  await updateSettings("models", { ...originalModels, image: { model: "nonexistent:model", referenceModel: null } });
  invalidateSettingsCache();
  u = await getUser(user.id);
  const beforeFail = u.creditsBalance;
  const fJob = await startGeneration(u, dream.id, { format: "slideshow", styleId: "anime", idempotencyKey: randomUUID(), locale: "ru" });
  const fDone = await waitJob(fJob.id, 120_000);
  await updateSettings("models", originalModels);
  u = await getUser(user.id);
  const fLedger = await ledger(fJob.id);
  check(fDone.status === "failed" && fDone.creditState === "released" && fJob.creditsCost > 0, `forced failure → job failed (${fDone.errorCode}), credits released`);
  check(u.creditsBalance === beforeFail && u.creditsReserved === 0 && fLedger.filter((t) => t.type === "release").length === 1, `balance restored (${beforeFail} → ${u.creditsBalance}), ledger: ${fLedger.map((t) => `${t.type}:${t.amount}`).join(", ")}`);
  const again = await releaseJobCredits(fJob.id, "test-double-release");
  u = await getUser(user.id);
  check(again.released === 0 && u.creditsBalance === beforeFail, "second release is a no-op (idempotent refund)");

  // ── 7. Cancellation mid-generation ──
  u = await getUser(user.id);
  const beforeCancel = u.creditsBalance;
  const cJob = await startGeneration(u, dream.id, { format: "slideshow", styleId: "watercolor", idempotencyKey: randomUUID(), locale: "ru" });
  await waitFor("cancel target running", async () => {
    const j = await job(cJob.id);
    return j.status !== "queued" ? j : null;
  }, 120_000, 300);
  await cancelJob(u, cJob.id);
  await new Promise((r) => setTimeout(r, 20_000));
  const cAfter = await job(cJob.id);
  u = await getUser(user.id);
  const cMedia = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, cJob.id), eq(dreamMedia.mediaType, "slideshow"), eq(dreamMedia.status, "ready")));
  check(cAfter.status === "cancelled" && cAfter.creditState === "released" && u.creditsBalance === beforeCancel && cMedia.length === 0, `cancelled job stays cancelled, credits returned, no result (${cAfter.status}/${cAfter.creditState})`);

  // ── 8. Kill the worker during a video job, restart, resume ──
  u = await getUser(user.id);
  const rq = await getQuote(u, dream.id, "ru");
  const longest = rq.video.options[rq.video.options.length - 1]!;
  const rJob = await startGeneration(u, dream.id, { format: "video", styleId: "dark_fantasy", targetDurationSec: longest.actualSec, idempotencyKey: randomUUID(), locale: "ru" });
  const mid = await waitFor("video job reaches clip stage with ≥1 clip done", async () => {
    const j = await job(rJob.id);
    if (j.status === "completed" || j.status === "failed") return j;
    return j.status === "generating_video" && (j.stageDetail?.done ?? 0) >= 1 ? j : null;
  }, 300_000, 250);
  const killedAt = mid.status;
  const clipsBefore = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, rJob.id), eq(dreamMedia.mediaType, "video_clip")));
  await killWorker();
  log(`killed worker at ${killedAt} (clips done ${mid.stageDetail?.done}/${mid.stageDetail?.total}, clip rows ${clipsBefore.length})`);
  check(killedAt === "generating_video", "worker killed mid-way through the video clips");
  startWorker("B");
  const rDone = await waitJob(rJob.id, 600_000);
  const plan = rDone.stageDetail?.plan ?? [];
  const rClips = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, rJob.id), eq(dreamMedia.mediaType, "video_clip")));
  const readyClips = rClips.filter((c) => c.status === "ready");
  const uniqueHashes = new Set(readyClips.map((c) => c.inputHash));
  const videoUsage = await db().select().from(aiUsage).where(and(eq(aiUsage.jobId, rJob.id), eq(aiUsage.kind, "video"), eq(aiUsage.success, true)));
  const rLedger = await ledger(rJob.id);
  check(rDone.status === "completed", `after restart the video job completed (status ${rDone.status}, error ${rDone.errorCode ?? "-"})`);
  check(readyClips.length === plan.length && uniqueHashes.size === plan.length, `each planned clip produced once (${readyClips.length} ready clips, plan ${plan.length}, rows total ${rClips.length})`);
  check(videoUsage.length === plan.length, `video provider usage recorded once per clip (${videoUsage.length})`);
  check(rLedger.filter((t) => t.type === "capture").length === 1 && rDone.creditState === "captured", "credits captured exactly once after resume");

  // ── 9. ensureClip resumes a stored provider task instead of resubmitting ──
  const fixture = path.join(tmp, "stub-result.mp4");
  ffmpegGen(["-f", "lavfi", "-i", "testsrc2=s=720x1280:d=2:r=30", "-pix_fmt", "yuv420p", fixture]);
  const fixtureUrl = `file://${fixture}`;
  let submits = 0;
  let readyNow = false;
  const demoSpec = findVideoModel("demo:video")!;
  const stub: VideoProvider = {
    isDemo: true,
    spec: { ...demoSpec, id: `test:stub-${randomUUID().slice(0, 6)}`, provider: "demo" },
    submit: async () => {
      submits++;
      return { externalId: "stub-task-1" };
    },
    getStatus: async () => (readyNow ? { state: "succeeded", videoUrl: fixtureUrl } : { state: "running" }),
  };
  const [keyframe] = await db().select().from(dreamMedia).where(and(eq(dreamMedia.dreamId, dream.id), eq(dreamMedia.mediaType, "image"), eq(dreamMedia.status, "ready")));
  const clipDir = await mkdtemp(path.join(os.tmpdir(), "dream-e2e-clip-"));
  const baseArgs = { dreamId: dream.id, userId: user.id, jobId: vJob.id, sceneId: keyframe!.sceneId!, keyframe: keyframe!, provider: stub, prompt: "stub prompt", durationSec: 5, variant: 4242, dir: clipDir, timeoutMs: 60_000, pollMinMs: 200, pollMaxMs: 400 };
  const first = new AbortController();
  let firstErr: unknown;
  try {
    await ensureClip({ ...baseArgs, signal: first.signal, onSubmitted: () => first.abort("shutdown") });
  } catch (err) {
    firstErr = err;
  }
  const [pending] = await db().select().from(dreamMedia).where(and(eq(dreamMedia.jobId, vJob.id), eq(dreamMedia.externalJobId, "stub-task-1")));
  check(firstErr instanceof JobCancelledError && pending?.status === "processing" && submits === 1, `interrupted clip keeps its provider task id (row ${pending?.status}, submits ${submits})`);
  readyNow = true;
  const resumed = await ensureClip({ ...baseArgs, signal: new AbortController().signal });
  const resumedInfo = await probe(fixture);
  check(resumed.id === pending?.id && resumed.status === "ready" && submits === 1, `resumed polling without resubmitting (submits ${submits}, clip ${resumed.status})`);
  check(resumedInfo.durationSec > 1, "stub fixture valid");

  // Restore models in case of early failure paths above.
  await updateSettings("models", originalModels);

  // ── 10. Maintenance job runs cleanly through the worker's system queue ──
  const system = getQueue(QUEUES.system);
  const maintId = `e2e-maintenance-${Date.now()}`;
  await system.add("maintenance", { type: "maintenance" }, { jobId: maintId, attempts: 1 });
  const maint = await waitFor("maintenance job", async () => {
    const j = await system.getJob(maintId);
    return j && (await j.isCompleted()) ? j : null;
  }, 120_000);
  const maintResult = maint.returnvalue as Record<string, number>;
  check(Object.values(maintResult).every((v) => v >= 0), `maintenance completed without step errors (${JSON.stringify(maintResult)})`);

  // ── 11. Account deletion purges rows and stored files ──
  if (process.env.E2E_KEEP !== "1") {
    const storedKey = sMedia?.storageKey;
    await requestAccountDeletion(await getUser(user.id));
    await waitFor("account purge", async () => {
      const [row] = await db().select({ id: users.id }).from(users).where(eq(users.id, user.id));
      return row ? null : true;
    }, 120_000);
    const [orphanDream] = await db().select({ id: dreams.id }).from(dreams).where(eq(dreams.id, dream.id));
    const fileGone = storedKey ? (await headObject(storedKey)) === null : true;
    check(!orphanDream && fileGone, "account deletion removed the user, dreams (cascade) and stored files");
  }
}

main()
  .catch((err) => {
    failures++;
    console.error("[e2e] ERROR", err);
  })
  .finally(async () => {
    await killWorker();
    await closeQueues();
    await closeRedis();
    await closeDb();
    console.log("\n──── summary ────");
    for (const r of results) console.log(r);
    console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
