import { and, asc, eq, isNull } from "drizzle-orm";
import { getImageProvider } from "../ai/registry";
import { getDb } from "../db/client";
import { dreamScenes, dreams } from "../db/schema";
import { logger } from "../logger";
import type { PreviewPayload } from "../queue";
import { hitRateLimit } from "../redis";
import { assertSpendBudget } from "../services/ai-usage";
import { getSettings } from "../settings";
import { classifyError, createJobDir, isFinalAttempt, removeDir, type AttemptInfo } from "./common";
import { ensureFrame, loadStylePreset } from "./frames";

const log = logger.child({ step: "preview" });

/**
 * Free preview: one frame of the first scene, shown on the format screen and
 * used as the dream cover. It uses exactly the inputs a first generation with
 * the dream's default style would use, so that generation reuses it for free.
 * Silently skipped when the daily preview quota or the free budget is exhausted.
 */
export async function processPreview(payload: PreviewPayload, attempt: AttemptInfo): Promise<{ status: string; mediaId?: string }> {
  const db = getDb();
  const settings = await getSettings();
  if (!settings.limits.freePreviewEnabled) return { status: "disabled" };
  const [dream] = await db.select().from(dreams).where(eq(dreams.id, payload.dreamId));
  if (!dream || dream.deletedAt || dream.status !== "ready" || !dream.bible) return { status: "skipped_state" };
  if (dream.coverMediaId) return { status: "has_cover" };
  const [scene] = await db
    .select()
    .from(dreamScenes)
    .where(and(eq(dreamScenes.dreamId, dream.id), eq(dreamScenes.analysisVersion, dream.analysisVersion)))
    .orderBy(asc(dreamScenes.sequenceNumber))
    .limit(1);
  if (!scene || scene.currentImageId) return { status: "skipped_scene" };

  let provider;
  try {
    provider = getImageProvider(settings.models.image.model);
  } catch (err) {
    log.info("preview skipped: image provider unavailable", { error: (err as Error).message });
    return { status: "provider_unavailable" };
  }
  if (provider.spec.requiresReferenceImage) return { status: "model_needs_reference" };
  try {
    await assertSpendBudget(provider.spec.costPerImageUsd, { free: true });
  } catch {
    return { status: "budget" };
  }
  // Count only the first attempt against the user's daily quota.
  if (attempt.attemptsMade === 0) {
    const rl = await hitRateLimit(`preview:${dream.userId}`, settings.limits.freePreviewsPerDay, 86_400);
    if (!rl.allowed) return { status: "quota" };
  }

  const { styleId, preset } = await loadStylePreset(dream.bible.style.styleId, dream.bible);
  const dir = await createJobDir(`preview-${dream.id}`);
  try {
    const media = await ensureFrame({
      dreamId: dream.id,
      userId: dream.userId,
      jobId: null,
      scene,
      bible: dream.bible,
      style: preset,
      styleId,
      provider,
      variant: 0,
      dir,
      owner: `preview:${dream.id}`,
    });
    await db
      .update(dreams)
      .set({ coverMediaId: media.id })
      .where(and(eq(dreams.id, dream.id), isNull(dreams.coverMediaId)));
    return { status: "ready", mediaId: media.id };
  } catch (err) {
    const c = classifyError(err);
    if (c.retryable && !isFinalAttempt(attempt)) throw err;
    log.warn("preview failed", { dreamId: dream.id, code: c.code, error: c.message });
    return { status: "failed" };
  } finally {
    await removeDir(dir);
  }
}
