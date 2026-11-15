import { eq } from "drizzle-orm";
import { composeImagePrompt, composeNegativePrompt, composeReferencePortraitPrompt, type StylePreset } from "../ai/compose";
import { fetchBytes } from "../ai/http";
import { getImageProvider } from "../ai/registry";
import type { AiCallContext, ImageProvider, ImageRequest } from "../ai/types";
import { getDb } from "../db/client";
import { dreamScenes, dreams, visualStyles } from "../db/schema";
import type { CharacterBibleEntry, DreamBible } from "../db/types";
import { ProviderError } from "../errors";
import { logger } from "../logger";
import { recordUsage } from "../services/ai-usage";
import { findCachedMedia, imageInputFor, imageInputHash, referenceInputHash, storeImage, type MediaRow } from "./assets";
import { produceOnce, sleepWithSignal, throwIfAborted } from "./common";

export type SceneRow = typeof dreamScenes.$inferSelect;

/** Generated frames are vertical 9:16 (both sides multiples of 16). */
export const FRAME_W = 864;
export const FRAME_H = 1536;

const FALLBACK_STYLE: StylePreset = {
  id: "cinematic",
  promptPrefix: "Cinematic film still, dramatic volumetric light, rich color grading, shallow depth of field",
  promptSuffix: "highly detailed",
  negativePrompt: "low quality, blurry",
};

/** Loads a style preset; "auto" resolves to the dream's bible style. Falls back to a built-in cinematic preset. */
export async function loadStylePreset(styleId: string, bible?: DreamBible | null): Promise<{ styleId: string; preset: StylePreset }> {
  let id = styleId;
  if (id === "auto") id = bible?.style.styleId && bible.style.styleId !== "auto" ? bible.style.styleId : "cinematic";
  const db = getDb();
  const [row] = await db.select().from(visualStyles).where(eq(visualStyles.id, id));
  if (row) return { styleId: row.id, preset: { id: row.id, promptPrefix: row.promptPrefix, promptSuffix: row.promptSuffix, negativePrompt: row.negativePrompt } };
  const [cinematic] = await db.select().from(visualStyles).where(eq(visualStyles.id, "cinematic"));
  if (cinematic) return { styleId: cinematic.id, preset: { id: cinematic.id, promptPrefix: cinematic.promptPrefix, promptSuffix: cinematic.promptSuffix, negativePrompt: cinematic.negativePrompt } };
  return { styleId: "cinematic", preset: FALLBACK_STYLE };
}

const log = logger.child({ step: "frames" });

/**
 * Calls an image provider, logs the cost (success and failure) and returns the
 * image bytes together with the provider that actually produced them. Retryable
 * failures are retried in place a limited number of times so one flaky frame
 * does not restart the whole job; when the model still fails or refuses the
 * prompt, its catalog fallback (`spec.fallbackId`) draws the frame instead.
 */
export async function callImageProvider(
  provider: ImageProvider,
  req: ImageRequest,
  ctx: AiCallContext,
  retries = 1,
): Promise<{ bytes: Buffer; seed?: number; costUsd: number; provider: ImageProvider }> {
  try {
    return { ...(await callOnce(provider, req, ctx, retries)), provider };
  } catch (err) {
    const fallback = ctx.signal?.aborted ? null : fallbackFor(provider, req);
    if (!fallback) throw err;
    log.warn("image model failed, drawing the frame with its fallback", { model: provider.spec.id, fallback: fallback.spec.id, error: (err as Error).message });
    return { ...(await callOnce(fallback, req, ctx, retries)), provider: fallback };
  }
}

function fallbackFor(provider: ImageProvider, req: ImageRequest): ImageProvider | null {
  const id = provider.spec.fallbackId;
  if (!id || provider.isDemo) return null;
  try {
    const fb = getImageProvider(id);
    // Never swap a real model for demo frames, and an edit model needs the reference.
    if (fb.isDemo || (fb.spec.requiresReferenceImage && !req.referenceImage)) return null;
    return fb;
  } catch {
    return null;
  }
}

async function callOnce(provider: ImageProvider, req: ImageRequest, ctx: AiCallContext, retries: number): Promise<{ bytes: Buffer; seed?: number; costUsd: number }> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(ctx.signal);
    const t0 = Date.now();
    try {
      const res = await provider.generate(req, ctx);
      await recordUsage({
        kind: "image",
        provider: provider.spec.provider,
        model: provider.spec.model,
        costUsd: res.costUsd,
        durationMs: Date.now() - t0,
        isDemo: provider.isDemo,
        userId: ctx.userId,
        jobId: ctx.jobId,
        dreamId: ctx.dreamId,
      });
      let bytes = res.bytes;
      if (!bytes && res.url) bytes = (await fetchBytes(provider.spec.provider, res.url, 5 * 60_000)).bytes;
      if (!bytes || bytes.length === 0) throw new ProviderError(provider.spec.provider, "empty image result", { retryable: true });
      return { bytes, seed: res.seed, costUsd: res.costUsd };
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      await recordUsage({
        kind: "image",
        provider: provider.spec.provider,
        model: provider.spec.model,
        costUsd: 0,
        success: false,
        error: (err as Error).message,
        durationMs: Date.now() - t0,
        isDemo: provider.isDemo,
        userId: ctx.userId,
        jobId: ctx.jobId,
        dreamId: ctx.dreamId,
      }).catch(() => undefined);
      const retryable = err instanceof ProviderError ? err.retryable : true;
      if (!retryable || attempt >= retries) throw err;
      await sleepWithSignal(3000 * (attempt + 1), ctx.signal);
    }
  }
}

export interface FrameRequest {
  dreamId: string;
  userId: string;
  /** null for the free preview frame. */
  jobId: string | null;
  scene: SceneRow;
  bible: DreamBible;
  style: StylePreset;
  styleId: string;
  provider: ImageProvider;
  /** Character reference portrait (only used when the provider accepts reference images). */
  reference?: MediaRow | null;
  /** 0 for the first generation; regenerations use other values so seeds and cache keys differ. */
  variant: number;
  dir: string;
  owner: string;
  signal?: AbortSignal;
}

export function planFrame(r: FrameRequest) {
  const useRef = Boolean(r.reference && r.provider.spec.supportsReferenceImage);
  const base = r.scene.seed ?? r.bible.seed;
  const seed = r.provider.spec.supportsSeed ? (base + r.variant * 7919) % 2147483647 : undefined;
  const prompt = composeImagePrompt(r.scene, r.bible, r.style, { withReference: useRef });
  const negative = r.provider.spec.supportsNegativePrompt ? composeNegativePrompt(r.scene, r.style) : undefined;
  const hash = imageInputHash({
    prompt,
    negative,
    seed,
    modelId: r.provider.spec.id,
    width: FRAME_W,
    height: FRAME_H,
    referenceMediaId: useRef ? r.reference!.id : null,
    variant: r.variant,
  });
  return { useRef, seed, prompt, negative, hash };
}

/**
 * Returns the frame for a scene: a cached identical frame if one exists
 * (including the free preview), otherwise generates and stores it. The scene's
 * `currentImageId` points at the result afterwards.
 */
export async function ensureFrame(r: FrameRequest): Promise<MediaRow> {
  const db = getDb();
  const plan = planFrame(r);
  if (r.provider.spec.requiresReferenceImage && !plan.useRef) {
    throw new ProviderError(r.provider.spec.provider, `${r.provider.spec.id} needs a reference image`, { retryable: false, code: "generation_failed" });
  }
  try {
    const media = await produceOnce({
      key: `lock:asset:${r.dreamId}:${plan.hash}`,
      owner: r.owner,
      ttlMs: 10 * 60_000,
      waitMs: 12 * 60_000,
      signal: r.signal,
      lookup: () => findCachedMedia(r.dreamId, plan.hash, "image"),
      produce: async () => {
        await db.update(dreamScenes).set({ status: "generating" }).where(eq(dreamScenes.id, r.scene.id));
        const referenceImage = plan.useRef ? await imageInputFor(r.reference!, r.dir) : undefined;
        const out = await callImageProvider(
          r.provider,
          { prompt: plan.prompt, negativePrompt: plan.negative, seed: plan.seed, width: FRAME_W, height: FRAME_H, referenceImage, label: r.scene.description },
          { userId: r.userId, jobId: r.jobId, dreamId: r.dreamId, signal: r.signal },
        );
        return storeImage({
          userId: r.userId,
          dreamId: r.dreamId,
          sceneId: r.scene.id,
          jobId: r.jobId,
          type: "image",
          bytes: out.bytes,
          dir: r.dir,
          provider: out.provider.spec.provider,
          model: out.provider.spec.model,
          seed: out.seed ?? plan.seed ?? null,
          prompt: plan.prompt,
          inputHash: plan.hash,
          styleId: r.styleId,
          isDemo: out.provider.isDemo,
          costUsd: out.costUsd,
        });
      },
    });
    await db.update(dreamScenes).set({ currentImageId: media.id, status: "ready" }).where(eq(dreamScenes.id, r.scene.id));
    return media;
  } catch (err) {
    await db
      .update(dreamScenes)
      .set({ status: r.signal?.aborted ? "pending" : "failed" })
      .where(eq(dreamScenes.id, r.scene.id))
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Character reference portrait (text-to-image) used to keep a character's
 * identity across frames with reference-capable models. Cached per dream.
 */
export async function ensureReferencePortrait(r: {
  dreamId: string;
  userId: string;
  jobId: string;
  character: CharacterBibleEntry;
  bible: DreamBible;
  style: StylePreset;
  styleId: string;
  provider: ImageProvider;
  dir: string;
  owner: string;
  create: boolean;
  signal?: AbortSignal;
}): Promise<MediaRow | null> {
  if (r.provider.spec.requiresReferenceImage) return null; // edit-only models cannot draw a portrait from text
  const prompt = composeReferencePortraitPrompt(r.character, r.bible, r.style);
  const seed = r.provider.spec.supportsSeed ? r.bible.seed : undefined;
  const hash = referenceInputHash({ characterKey: r.character.key, prompt, seed, modelId: r.provider.spec.id, width: FRAME_W, height: FRAME_H });
  const cached = await findCachedMedia(r.dreamId, hash, "reference");
  if (cached || !r.create) return cached ?? null;
  const media = await produceOnce({
    key: `lock:asset:${r.dreamId}:${hash}`,
    owner: r.owner,
    ttlMs: 10 * 60_000,
    waitMs: 12 * 60_000,
    signal: r.signal,
    lookup: () => findCachedMedia(r.dreamId, hash, "reference"),
    produce: async () => {
      const out = await callImageProvider(r.provider, { prompt, seed, width: FRAME_W, height: FRAME_H, label: `${r.character.name} — reference` }, { userId: r.userId, jobId: r.jobId, dreamId: r.dreamId, signal: r.signal });
      return storeImage({
        userId: r.userId,
        dreamId: r.dreamId,
        sceneId: null,
        jobId: r.jobId,
        type: "reference",
        bytes: out.bytes,
        dir: r.dir,
        provider: out.provider.spec.provider,
        model: out.provider.spec.model,
        seed: out.seed ?? seed ?? null,
        prompt,
        inputHash: hash,
        styleId: r.styleId,
        characterKey: r.character.key,
        isDemo: out.provider.isDemo,
        costUsd: out.costUsd,
      });
    },
  });
  // Remember it in the Character Bible (merged under a row lock — two jobs may run for one dream).
  await getDb().transaction(async (tx) => {
    const [d] = await tx.select({ bible: dreams.bible }).from(dreams).where(eq(dreams.id, r.dreamId)).for("update");
    if (!d?.bible) return;
    const characters = d.bible.characters.map((c) => (c.key === r.character.key ? { ...c, referenceMediaId: media.id } : c));
    await tx
      .update(dreams)
      .set({ bible: { ...d.bible, characters } })
      .where(eq(dreams.id, r.dreamId));
  });
  return media;
}
