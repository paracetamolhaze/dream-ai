import path from "node:path";
import { and, eq } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";
import { getSttProvider } from "../ai/registry";
import type { SttResult } from "../ai/types";
import { getDb } from "../db/client";
import { dreams, users } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { msg } from "../i18n";
import { logger } from "../logger";
import { FfmpegError, measureVolume, probe, transcodeForStt } from "../media/ffmpeg";
import type { TranscriptionPayload } from "../queue";
import { recordUsage } from "../services/ai-usage";
import { track } from "../services/analytics";
import { sendToChat } from "../services/notify";
import { getUserSettings, userLocale } from "../services/users";
import { getSettings } from "../settings";
import { deleteObjects, downloadToFile } from "../storage";
import { InlineKeyboard, webAppUrl } from "../telegram/bot-api";
import { sanitizeUserText, truncate } from "../utils";
import { classifyError, createJobDir, isFinalAttempt, releaseLock, removeDir, tryLock, type AttemptInfo } from "./common";
import { routes } from "../routes";

const log = logger.child({ step: "transcription" });

/** Recordings quieter than this peak level (dBFS) are treated as silent. */
const SILENCE_MAX_DB = -50;

/** Cuts long transcripts at a sentence boundary so the user can still continue. */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "), slice.lastIndexOf("\n"));
  return (end > max * 0.6 ? slice.slice(0, end + 1) : slice).trim();
}

function normalizeLanguage(l?: string | null): string | null {
  if (!l) return null;
  const s = l.toLowerCase();
  if (s === "russian" || s.startsWith("ru")) return "ru";
  if (s === "english" || s.startsWith("en")) return "en";
  return s.slice(0, 8);
}

/**
 * Speech-to-text for one dream recording. Idempotent: only dreams still in
 * `transcribing` with the same audio key are updated.
 */
export async function processTranscription(payload: TranscriptionPayload, attempt: AttemptInfo): Promise<{ status: string }> {
  const db = getDb();
  const [dream] = await db.select().from(dreams).where(eq(dreams.id, payload.dreamId));
  if (!dream || dream.deletedAt) return { status: "skipped_deleted" };
  if (dream.status !== "transcribing") return { status: "skipped_state" };
  const [user] = await db.select().from(users).where(eq(users.id, dream.userId));
  if (!user || user.status === "deleted") return { status: "skipped_user" };
  const locale = userLocale(user);
  const m = msg(locale);
  const audioKey = dream.originalAudioKey;

  const lockKey = `lock:stt:${dream.id}`;
  if (!(await tryLock(lockKey, attempt.owner, 15 * 60_000))) return { status: "skipped_locked" };
  const dir = await createJobDir(`stt-${dream.id}`);
  try {
    if (!audioKey) throw new AppError("transcription_failed", "dream has no audio", { retryable: false });
    const ext = path.extname(audioKey).slice(1) || "bin";
    const original = path.join(dir, `original.${ext}`);
    await downloadToFile(audioKey, original);

    // Normalize first: MediaRecorder WebM files often have no duration header,
    // the MP3 output has a reliable one.
    const speech = path.join(dir, "speech.mp3");
    try {
      await transcodeForStt(original, speech);
    } catch (err) {
      if (err instanceof FfmpegError) throw new AppError("audio_unsupported", "audio could not be decoded", { retryable: false, cause: err });
      throw err;
    }
    const info = await probe(speech);
    if (info.durationSec > env().MAX_AUDIO_SECONDS + 1) throw new AppError("audio_too_long", "recording too long", { retryable: false });
    if (info.durationSec < 0.5) throw new AppError("audio_empty", "recording is empty", { retryable: false });
    const volume = await measureVolume(speech);
    if (volume.maxDb !== null && volume.maxDb < SILENCE_MAX_DB) throw new AppError("audio_empty", "recording is silent", { retryable: false });

    const settings = await getSettings();
    const provider = getSttProvider(settings);
    const language = settings.models.stt.language === "auto" ? undefined : settings.models.stt.language;
    const t0 = Date.now();
    let res: SttResult;
    try {
      res = await provider.transcribe({ filePath: speech, fileName: "dream.mp3", mime: "audio/mpeg", durationSec: info.durationSec, language }, { userId: user.id, dreamId: dream.id });
    } catch (err) {
      await recordUsage({ kind: "stt", provider: provider.id, model: provider.model, costUsd: 0, success: false, error: (err as Error).message, isDemo: provider.isDemo, userId: user.id, dreamId: dream.id, durationMs: Date.now() - t0 }).catch(() => undefined);
      throw err;
    }
    await recordUsage({
      kind: "stt",
      provider: provider.id,
      model: provider.model,
      costUsd: res.costUsd,
      units: Math.round((info.durationSec / 60) * 100) / 100,
      unit: "minute",
      durationMs: Date.now() - t0,
      isDemo: provider.isDemo,
      userId: user.id,
      dreamId: dream.id,
    });

    let text = sanitizeUserText(res.text ?? "");
    if (!text) throw new AppError("transcription_failed", "empty transcript", { retryable: false });
    text = cutAtSentence(text, env().MAX_DREAM_TEXT_CHARS);

    const updated = await db
      .update(dreams)
      .set({
        originalText: text,
        editedText: text,
        language: normalizeLanguage(res.language) ?? dream.language,
        audioDurationSec: Math.round(info.durationSec * 10) / 10,
        transcriptionIsDemo: provider.isDemo,
        status: "review",
        errorCode: null,
      })
      .where(and(eq(dreams.id, dream.id), eq(dreams.status, "transcribing"), eq(dreams.originalAudioKey, audioKey)))
      .returning({ id: dreams.id });
    if (updated.length === 0) return { status: "superseded" };
    await track("transcription_completed", user.id, { durationSec: Math.round(info.durationSec), demo: provider.isDemo });

    // Retention policy "0 days": the original recording is not kept after transcription.
    const prefs = await getUserSettings(user.id);
    const retentionDays = prefs.audioRetentionDays ?? settings.retention.audioRetentionDays;
    if (retentionDays === 0) {
      await deleteObjects([audioKey]);
      await db.update(dreams).set({ audioDeletedAt: new Date() }).where(and(eq(dreams.id, dream.id), eq(dreams.originalAudioKey, audioKey)));
    }

    if (payload.replyChatId) {
      await sendToChat(payload.replyChatId, m.transcriptReady(truncate(text, 700)), new InlineKeyboard().webApp(m.btnReview, webAppUrl(routes.review(dream.id))));
    }
    return { status: "review" };
  } catch (err) {
    const c = classifyError(err);
    if (c.retryable && !isFinalAttempt(attempt)) {
      log.warn("transcription attempt failed, will retry", { dreamId: dream.id, code: c.code, error: c.message });
      throw err;
    }
    log.warn("transcription failed", { dreamId: dream.id, code: c.code, error: c.message });
    await db
      .update(dreams)
      .set({ status: "transcription_failed", errorCode: c.code })
      .where(and(eq(dreams.id, dream.id), eq(dreams.status, "transcribing")));
    await track("transcription_failed", user.id, { code: c.code });
    if (payload.replyChatId) {
      const text = c.code === "audio_too_long" ? m.voiceTooLong(Math.round(env().MAX_AUDIO_SECONDS / 60)) : m.transcriptionFailed;
      await sendToChat(payload.replyChatId, text);
    }
    throw new UnrecoverableError(`${c.code}: ${c.message}`);
  } finally {
    await releaseLock(lockKey, attempt.owner);
    await removeDir(dir);
  }
}
