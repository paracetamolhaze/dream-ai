import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DreamAnalysis } from "@dream/core/ai/analysis";
import { findVideoModel } from "@dream/core/ai/models";
import type { VideoProvider } from "@dream/core/ai/types";
import { closeDb, getDb } from "@dream/core/db/client";
import { aiUsage, creditTransactions, dreamMedia, generationJobs, musicTracks } from "@dream/core/db/schema";
import { probe } from "@dream/core/media/ffmpeg";
import { AppError, ProviderError } from "@dream/core/errors";
import { postProcessAnalysis } from "@dream/core/pipeline/analyze";
import { classifyError, isFinalAttempt, JobCancelledError, runPool } from "@dream/core/pipeline/common";
import { ensureClip, processGeneration } from "@dream/core/pipeline/generate";
import { isReminderDue, localClock } from "@dream/core/pipeline/system";
import { cutAtSentence } from "@dream/core/pipeline/transcribe";
import { closeQueues } from "@dream/core/queue";
import { closeRedis } from "@dream/core/redis";
import { grantCredits } from "@dream/core/services/credits";
import { startGeneration } from "@dream/core/services/generation";
import { getSettings, updateSettings, type Settings } from "@dream/core/settings";
import { downloadToFile, headObject } from "@dream/core/storage";
import { createReadyDream, createUser, getUserRow, integration } from "../../../packages/core/test/helpers";

// ─── Pure logic ─────────────────────────────────────────────────────────────

function rawAnalysis(overrides: Partial<DreamAnalysis> = {}): DreamAnalysis {
  const scene = (i: number, importance = 2): DreamAnalysis["scenes"][number] => ({
    title: `Сцена ${i}`,
    description: `Описание ${i}`,
    action: `action ${i}`,
    mood: "eerie",
    characters: ["Я", "faceless man"],
    location: "red_city",
    cameraAngle: "wide shot",
    composition: "",
    motion: "slow push in",
    imagePrompt: `image prompt ${i}`,
    videoPrompt: `video prompt ${i}`,
    negativePrompt: "",
    importance,
  });
  return {
    title: "«Город без людей».",
    summary: "Сон о городе",
    language: "ru",
    atmosphere: "тревожная",
    mood: "eerie",
    suggestedStyle: "cinematic",
    style: { palette: "red", lighting: "dusk", lens: "35mm", texture: "grain", mood: "eerie" },
    characters: [
      { key: "faceless man", name: "Человек без лица", role: "stranger", appearance: "tall", hair: "", clothing: "grey coat", distinctiveFeatures: "no face", age: "", palette: "grey", visualTag: "a tall faceless man in a grey coat" },
      { key: "faceless man", name: "Двойник", role: "stranger", appearance: "", hair: "", clothing: "", distinctiveFeatures: "", age: "", palette: "", visualTag: "" },
    ],
    locations: [{ key: "Red City", name: "Город", description: "abandoned city", architecture: "", lighting: "red sky", timeOfDay: "dusk", weather: "", atmosphere: "empty", visualTag: "an abandoned city under a red sky" }],
    scenes: [scene(1, 3), scene(2, 1), scene(3, 2), scene(4, 1), scene(5, 3)],
    ...overrides,
  };
}

describe("postProcessAnalysis", () => {
  it("normalizes keys, dedupes characters and repairs scene references", () => {
    const out = postProcessAnalysis(rawAnalysis(), { minScenes: 3, maxScenes: 12, locale: "ru" });
    expect(out.title).toBe("Город без людей");
    const keys = out.characters.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("faceless_man");
    // First-person "Я" in scenes creates a neutral dreamer character.
    expect(keys[0]).toBe("dreamer");
    expect(out.characters[0]!.visualTag).toMatch(/face not visible/);
    expect(out.locations[0]!.key).toBe("red_city");
    for (const s of out.scenes) {
      expect(s.location).toBe("red_city");
      expect(s.characters.every((k) => keys.includes(k))).toBe(true);
      expect(s.characters).toContain("dreamer");
    }
  });

  it("drops the least important beats but keeps order, opening and ending", () => {
    const out = postProcessAnalysis(rawAnalysis(), { minScenes: 1, maxScenes: 3, locale: "ru" });
    expect(out.scenes.map((s) => s.title)).toEqual(["Сцена 1", "Сцена 3", "Сцена 5"]);
  });

  it("never pads scenes up to the minimum and clamps importance", () => {
    const raw = rawAnalysis({ scenes: [{ ...rawAnalysis().scenes[0]!, importance: 9 }] });
    const out = postProcessAnalysis(raw, { minScenes: 3, maxScenes: 12, locale: "ru" });
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0]!.importance).toBe(3);
  });

  it("creates a default location when none is given", () => {
    const out = postProcessAnalysis(rawAnalysis({ locations: [] }), { minScenes: 1, maxScenes: 12, locale: "en" });
    expect(out.locations).toHaveLength(1);
    expect(out.scenes.every((s) => s.location === out.locations[0]!.key)).toBe(true);
  });
});

describe("pipeline helpers", () => {
  it("decides final attempts", () => {
    expect(isFinalAttempt({ attemptsMade: 0, attempts: 3 })).toBe(false);
    expect(isFinalAttempt({ attemptsMade: 2, attempts: 3 })).toBe(true);
  });

  it("classifies errors for retry decisions", () => {
    expect(classifyError(new ProviderError("fal", "boom", { retryable: true })).retryable).toBe(true);
    expect(classifyError(new ProviderError("fal", "nsfw", { retryable: false, code: "provider_rejected_content" }))).toMatchObject({ retryable: false, code: "provider_rejected_content" });
    expect(classifyError(new AppError("dream_not_ready")).retryable).toBe(false);
    expect(classifyError(new Error("socket hang up")).retryable).toBe(true);
  });

  it("runPool stops scheduling after the first error and waits for in-flight tasks", async () => {
    const started: number[] = [];
    let inFlightAborted = 0;
    const err = await runPool([0, 1, 2, 3, 4, 5], 2, new AbortController().signal, async (i, _idx, signal) => {
      started.push(i);
      if (i === 1) throw new Error("fail-1");
      await new Promise((r) => setTimeout(r, 30));
      if (signal.aborted) inFlightAborted++;
      return i;
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe("fail-1");
    expect(started.length).toBeLessThan(6);
    expect(inFlightAborted).toBeGreaterThanOrEqual(1);
  });

  it("cuts long transcripts at a sentence boundary", () => {
    const text = "Первое предложение. Второе предложение. Третье предложение очень длинное.";
    expect(cutAtSentence(text, 45)).toBe("Первое предложение. Второе предложение.");
    expect(cutAtSentence("short", 100)).toBe("short");
  });

  it("schedules morning reminders in the user's time zone", () => {
    const now = new Date("2026-11-14T05:32:00Z"); // 08:32 in Moscow
    const clock = localClock("Europe/Moscow", now);
    expect(clock.date).toBe("2026-11-14");
    expect(clock.minutes).toBe(8 * 60 + 32);
    expect(isReminderDue("08:30", clock.minutes)).toBe(true);
    expect(isReminderDue("08:00", clock.minutes)).toBe(false);
    expect(isReminderDue("23:58", 3)).toBe(true); // wraps past midnight
    expect(localClock("Not/AZone", now).minutes).toBe(clock.minutes); // invalid tz → default (Moscow)
  });
});

// ─── Integration: in-process generation with demo providers ─────────────────

const hasS3 = process.env.S3_AVAILABLE !== "0";

describe.skipIf(!integration || !hasS3)("generation pipeline (demo providers, in-process)", () => {
  let original: Settings["generation"];
  beforeAll(async () => {
    original = (await getSettings({ fresh: true })).generation;
    // Small canvas keeps FFmpeg fast in tests.
    await updateSettings("generation", { ...original, outputWidth: 360, outputHeight: 640, fps: 24 });
  });
  afterAll(async () => {
    await updateSettings("generation", original);
    await closeQueues();
    await closeRedis();
    await closeDb();
  });

  it("renders a slideshow, stores it, captures credits and reuses frames on regeneration", async () => {
    const user = await createUser({ freeSlideshowsUsed: 99 });
    await grantCredits({ userId: user.id, amount: 100, type: "admin_grant" });
    const dream = await createReadyDream(user.id, { scenes: 3 });
    const job = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: randomUUID(), locale: "ru" });
    const res = await processGeneration(job.id, { attemptsMade: 0, attempts: 3, owner: job.id });
    expect(res.status).toBe("completed");
    const [done] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(done).toMatchObject({ status: "completed", progress: 100, creditState: "captured" });
    expect(done!.stageDetail?.previewMediaIds).toHaveLength(3);
    const [media] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, done!.resultMediaId!));
    expect(media).toMatchObject({ mediaType: "slideshow", status: "ready", width: 360, height: 640, isDemo: true });
    expect(media!.durationSec).toBeCloseTo(3 * original.slideshowSecondsPerScene, 0);
    expect((await headObject(media!.storageKey!))?.size).toBeGreaterThan(1000);
    const u = await getUserRow(user.id);
    expect(u.creditsReserved).toBe(0);
    const ledger = await getDb().select().from(creditTransactions).where(eq(creditTransactions.jobId, job.id));
    expect(ledger.map((t) => t.type).sort()).toEqual(["capture", "reserve"]);

    // Re-running the same (completed) job is a no-op.
    expect((await processGeneration(job.id, { attemptsMade: 1, attempts: 3, owner: job.id })).status).toBe("completed");

    // A video of the same dream reuses the keyframes (no new image calls).
    const video = await startGeneration(await getUserRow(user.id), dream.id, { format: "video", styleId: "cinematic", targetDurationSec: 10, idempotencyKey: randomUUID(), locale: "ru" });
    const vres = await processGeneration(video.id, { attemptsMade: 0, attempts: 3, owner: video.id });
    expect(vres.status).toBe("completed");
    const newImages = await getDb().select().from(aiUsage).where(and(eq(aiUsage.jobId, video.id), eq(aiUsage.kind, "image")));
    expect(newImages).toHaveLength(0);
    const [vjob] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, video.id));
    const [vmedia] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, vjob!.resultMediaId!));
    expect(vmedia!.mediaType).toBe("video");
    expect(vmedia!.durationSec).toBeCloseTo(10, 0);

    // Regenerate one scene's frame → one new image call, a new slideshow version, other frames reused.
    const plan = vjob!.stageDetail!.plan!;
    const sceneId = plan[0]!.sceneId;
    const regen = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: randomUUID(), locale: "ru", kind: "scene_image", sceneId });
    expect((await processGeneration(regen.id, { attemptsMade: 0, attempts: 3, owner: regen.id })).status).toBe("completed");
    const regenImages = await getDb().select().from(aiUsage).where(and(eq(aiUsage.jobId, regen.id), eq(aiUsage.kind, "image")));
    expect(regenImages).toHaveLength(1);
    const [rjob] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, regen.id));
    const [rmedia] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, rjob!.resultMediaId!));
    expect(rmedia).toMatchObject({ mediaType: "slideshow", version: 2, status: "ready" });

    // Regenerate one scene of the video → new keyframe + new clip, re-assembled video version 2 with the same cut.
    const vregen = await startGeneration(await getUserRow(user.id), dream.id, { format: "video", styleId: "cinematic", idempotencyKey: randomUUID(), locale: "ru", kind: "scene_video", sceneId });
    expect((await processGeneration(vregen.id, { attemptsMade: 0, attempts: 3, owner: vregen.id })).status).toBe("completed");
    const vregenClips = await getDb().select().from(aiUsage).where(and(eq(aiUsage.jobId, vregen.id), eq(aiUsage.kind, "video")));
    expect(vregenClips).toHaveLength(1);
    const [vrjob] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, vregen.id));
    const [vrmedia] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, vrjob!.resultMediaId!));
    expect(vrmedia).toMatchObject({ mediaType: "video", version: 2, status: "ready" });
    expect(vrmedia!.durationSec).toBeCloseTo(10, 0);
    // Credits: two full jobs + two scene regenerations, all captured; nothing left reserved.
    expect((await getUserRow(user.id)).creditsReserved).toBe(0);
  }, 420_000);

  it("renders without music when the chosen track was deactivated or its file is gone", async () => {
    const user = await createUser();
    const dream = await createReadyDream(user.id, { scenes: 1 });
    const [track] = await getDb()
      .insert(musicTracks)
      .values({ title: "Gone", license: "test", storageKey: `library/music/missing-${randomUUID()}.mp3`, isActive: true })
      .returning();
    // Active row, missing file.
    const a = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "cinematic", musicTrackId: track!.id, idempotencyKey: randomUUID(), locale: "ru" });
    expect((await processGeneration(a.id, { attemptsMade: 0, attempts: 3, owner: a.id })).status).toBe("completed");
    // Deactivated after the job was created.
    await grantCredits({ userId: user.id, amount: 20, type: "admin_grant" });
    const b = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "anime", musicTrackId: track!.id, idempotencyKey: randomUUID(), locale: "ru" });
    await getDb().update(musicTracks).set({ isActive: false }).where(eq(musicTracks.id, track!.id));
    expect((await processGeneration(b.id, { attemptsMade: 0, attempts: 3, owner: b.id })).status).toBe("completed");
    const [jb] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, b.id));
    const [mb] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, jb!.resultMediaId!));
    const dir = await mkdtemp(path.join(os.tmpdir(), "dream-music-test-"));
    const local = path.join(dir, "out.mp4");
    await downloadToFile(mb!.storageKey!, local);
    expect((await probe(local)).hasAudio).toBe(false);
  }, 180_000);

  it("fails non-retryable errors once and returns the credits", async () => {
    const user = await createUser({ freeSlideshowsUsed: 99 });
    await grantCredits({ userId: user.id, amount: 50, type: "admin_grant" });
    const dream = await createReadyDream(user.id, { scenes: 2 });
    const job = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: randomUUID(), locale: "ru" });
    await getDb().update(generationJobs).set({ model: "nonexistent:model" }).where(eq(generationJobs.id, job.id));
    await expect(processGeneration(job.id, { attemptsMade: 0, attempts: 3, owner: job.id })).rejects.toThrow();
    const [failed] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(failed).toMatchObject({ status: "failed", creditState: "released" });
    expect((await getUserRow(user.id)).creditsBalance).toBe(50);
    // A late duplicate run (e.g. a stalled copy) changes nothing.
    expect((await processGeneration(job.id, { attemptsMade: 1, attempts: 3, owner: job.id })).status).toBe("failed");
    const ledger = await getDb().select().from(creditTransactions).where(eq(creditTransactions.jobId, job.id));
    expect(ledger.filter((t) => t.type === "release")).toHaveLength(1);
  }, 120_000);

  it("resumes a submitted video task after an interruption instead of paying again", async () => {
    const user = await createUser();
    const dream = await createReadyDream(user.id, { scenes: 1 });
    const job = await startGeneration(await getUserRow(user.id), dream.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: randomUUID(), locale: "ru" });
    await processGeneration(job.id, { attemptsMade: 0, attempts: 3, owner: job.id });
    const [keyframe] = await getDb().select().from(dreamMedia).where(and(eq(dreamMedia.dreamId, dream.id), eq(dreamMedia.mediaType, "image")));
    const dir = await mkdtemp(path.join(os.tmpdir(), "dream-clip-test-"));
    const fixture = path.join(dir, "fixture.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:d=2:r=24", "-pix_fmt", "yuv420p", fixture]);
    let submits = 0;
    let ready = false;
    const stub: VideoProvider = {
      isDemo: true,
      spec: { ...findVideoModel("demo:video")!, id: `test:stub-${randomUUID().slice(0, 6)}` },
      submit: async () => {
        submits++;
        return { externalId: "task-42" };
      },
      getStatus: async () => (ready ? { state: "succeeded", videoUrl: `file://${fixture}` } : { state: "running" }),
    };
    const args = { dreamId: dream.id, userId: user.id, jobId: job.id, sceneId: keyframe!.sceneId!, keyframe: keyframe!, provider: stub, prompt: "p", durationSec: 5, variant: 1, dir, timeoutMs: 30_000, pollMinMs: 50, pollMaxMs: 100 };
    const interrupted = new AbortController();
    await expect(ensureClip({ ...args, signal: interrupted.signal, onSubmitted: () => interrupted.abort("shutdown") })).rejects.toBeInstanceOf(JobCancelledError);
    const [pending] = await getDb().select().from(dreamMedia).where(and(eq(dreamMedia.dreamId, dream.id), eq(dreamMedia.mediaType, "video_clip")));
    expect(pending).toMatchObject({ status: "processing", externalJobId: "task-42" });
    ready = true;
    const clip = await ensureClip({ ...args, signal: new AbortController().signal });
    expect(clip.id).toBe(pending!.id);
    expect(clip.status).toBe("ready");
    expect(submits).toBe(1);
    // Identical inputs later → cached, still one submission.
    const again = await ensureClip({ ...args, signal: new AbortController().signal });
    expect(again.id).toBe(clip.id);
    expect(submits).toBe(1);
  }, 120_000);
});
