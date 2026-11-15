import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const sent: { method: string; chatId: number; text?: string; markup?: unknown }[] = [];

// Fake Bot API: records calls instead of talking to Telegram.
vi.mock("../src/telegram/bot-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/telegram/bot-api")>();
  return {
    ...real,
    hasBotToken: () => true,
    botApi: () => ({
      sendMessage: async (chatId: number, text: string, other?: { reply_markup?: unknown }) => {
        sent.push({ method: "sendMessage", chatId, text, markup: other?.reply_markup });
        return { message_id: 1 };
      },
      sendVideo: async (chatId: number, _file: unknown, other?: { caption?: string; reply_markup?: unknown }) => {
        sent.push({ method: "sendVideo", chatId, text: other?.caption, markup: other?.reply_markup });
        return { message_id: 2, video: { file_id: "tg-file-id-1" } };
      },
    }),
  };
});

const { closeDb, getDb } = await import("../src/db/client");
const { dreamMedia, dreams, generationJobs } = await import("../src/db/schema");
const { closeQueues, getQueue, QUEUES } = await import("../src/queue");
const { closeRedis, getRedis } = await import("../src/redis");
const { createVoiceDream } = await import("../src/services/dreams");
const { notifyGenerationCompleted, notifyGenerationFailed } = await import("../src/services/notify");
const { headObject, putObject } = await import("../src/storage");
const { probe, transcodeForStt } = await import("../src/media/ffmpeg");
const { createReadyDream, createUser, integration } = await import("./helpers");

function ffmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = integration && process.env.S3_AVAILABLE === "1" && ffmpegAvailable();

describe.skipIf(!canRun)("voice message intake", () => {
  let dir = "";
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dream-test-"));
    await getRedis().flushdb();
  });
  afterAll(async () => {
    await closeQueues();
    await closeRedis();
    await closeDb();
  });

  it("stores a Telegram-style OGG/Opus voice privately and queues transcription", async () => {
    const ogg = path.join(dir, "voice.ogg");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", ogg]);
    const u = await createUser();
    const dream = await createVoiceDream(u, readFileSync(ogg), { source: "bot_voice", replyChatId: u.telegramId, durationHintSec: 2 });
    expect(dream.status).toBe("transcribing");
    expect(dream.audioMime).toBe("audio/ogg");
    expect(dream.originalAudioKey).toMatch(new RegExp(`^u/${u.id}/d/${dream.id}/audio/`));
    expect(await headObject(dream.originalAudioKey!)).not.toBeNull();
    const job = await getQueue(QUEUES.transcription).getJob(`stt-${dream.id}-1`);
    expect(job?.data).toMatchObject({ dreamId: dream.id, replyChatId: u.telegramId });
    // The worker normalizes audio for STT — check that step on the same file.
    const mp3 = path.join(dir, "voice.mp3");
    await transcodeForStt(ogg, mp3);
    expect((await probe(mp3)).durationSec).toBeGreaterThan(1.5);
  });

  it("rejects non-audio uploads by content", async () => {
    const u = await createUser();
    await expect(createVoiceDream(u, Buffer.from("%PDF-1.7".padEnd(4000, "x")), { source: "miniapp_voice" })).rejects.toMatchObject({ code: "audio_unsupported" });
  });
});

describe.skipIf(!integration || process.env.S3_AVAILABLE !== "1")("bot notifications", () => {
  it("sends the finished film once with a button into the Mini App", async () => {
    sent.length = 0;
    const u = await createUser({ botChatAvailable: true });
    const d = await createReadyDream(u.id, { title: "Красное небо" });
    const key = `u/${u.id}/d/${d.id}/media/result.mp4`;
    await putObject(key, Buffer.from("fake-mp4"), "video/mp4");
    const [media] = await getDb().insert(dreamMedia).values({ dreamId: d.id, userId: u.id, mediaType: "slideshow", format: "mp4", storageKey: key, status: "ready", sizeBytes: 8, durationSec: 20 }).returning();
    const [job] = await getDb()
      .insert(generationJobs)
      .values({ userId: u.id, dreamId: d.id, mediaType: "slideshow", status: "completed", resultMediaId: media!.id, options: { styleId: "cinematic", watermark: false, action: "slideshow", locale: "ru" } })
      .returning();
    await notifyGenerationCompleted(job!.id);
    await notifyGenerationCompleted(job!.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("sendVideo");
    expect(sent[0]!.chatId).toBe(u.telegramId);
    expect(sent[0]!.text).toContain("Красное небо");
    expect(JSON.stringify(sent[0]!.markup)).toContain(`/dream?id=${d.id}`);
    const [m] = await getDb().select().from(dreamMedia).where(eq(dreamMedia.id, media!.id));
    expect(m!.telegramFileId).toBe("tg-file-id-1");
  });

  it("explains failures and mentions the refund", async () => {
    sent.length = 0;
    const u = await createUser({ botChatAvailable: true });
    const d = await createReadyDream(u.id, { title: "Последний поезд" });
    await getDb().update(dreams).set({ title: "Последний поезд" }).where(eq(dreams.id, d.id));
    const [job] = await getDb()
      .insert(generationJobs)
      .values({ userId: u.id, dreamId: d.id, mediaType: "video", status: "failed", errorCode: "provider_unavailable", options: { styleId: "cinematic", watermark: false, action: "video_short", locale: "ru" } })
      .returning();
    await notifyGenerationFailed(job!.id, true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Последний поезд");
    expect(sent[0]!.text).toContain("Кредиты возвращены");
  });
});
