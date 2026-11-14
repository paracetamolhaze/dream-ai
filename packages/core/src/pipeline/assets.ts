import { randomUUID } from "node:crypto";
import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { workDir } from "../ai/providers/demo";
import { fetchBytes } from "../ai/http";
import type { ImageInput } from "../ai/types";
import { getDb } from "../db/client";
import { dreamMedia } from "../db/schema";
import { ProviderError } from "../errors";
import { makeThumbnail, probe, toJpeg } from "../media/ffmpeg";
import { downloadToFile, keys, providerAccessibleUrl, uploadFile } from "../storage";
import { sha256 } from "../utils";

export type MediaRow = typeof dreamMedia.$inferSelect;
type MediaType = MediaRow["mediaType"];

// ─── Hashing (cache keys) ───────────────────────────────────────────────────

/** Everything that determines a generated frame. Same hash ⇒ same frame ⇒ reuse instead of paying again. */
export function imageInputHash(p: {
  prompt: string;
  negative?: string | null;
  seed?: number | null;
  modelId: string;
  width: number;
  height: number;
  referenceMediaId?: string | null;
  variant: number;
}): string {
  return sha256(
    JSON.stringify({
      v: 1,
      k: "image",
      prompt: p.prompt,
      negative: p.negative ?? null,
      seed: p.seed ?? null,
      model: p.modelId,
      w: p.width,
      h: p.height,
      ref: p.referenceMediaId ?? null,
      variant: p.variant,
    }),
  );
}

export function referenceInputHash(p: { characterKey: string; prompt: string; seed?: number | null; modelId: string; width: number; height: number }): string {
  return sha256(JSON.stringify({ v: 1, k: "reference", c: p.characterKey, prompt: p.prompt, seed: p.seed ?? null, model: p.modelId, w: p.width, h: p.height }));
}

export function clipInputHash(p: { keyframeMediaId: string; prompt: string; negative?: string | null; durationSec: number; modelId: string; seed?: number | null; variant: number }): string {
  return sha256(
    JSON.stringify({
      v: 1,
      k: "clip",
      key: p.keyframeMediaId,
      prompt: p.prompt,
      negative: p.negative ?? null,
      d: p.durationSec,
      model: p.modelId,
      seed: p.seed ?? null,
      variant: p.variant,
    }),
  );
}

// ─── Lookups ────────────────────────────────────────────────────────────────

export async function findCachedMedia(dreamId: string, inputHash: string, type: MediaType): Promise<MediaRow | undefined> {
  const [m] = await getDb()
    .select()
    .from(dreamMedia)
    .where(and(eq(dreamMedia.dreamId, dreamId), eq(dreamMedia.inputHash, inputHash), eq(dreamMedia.mediaType, type), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)))
    .orderBy(desc(dreamMedia.createdAt))
    .limit(1);
  return m && m.storageKey ? m : undefined;
}

export async function latestReadyMedia(dreamId: string, type: MediaType): Promise<MediaRow | undefined> {
  const [m] = await getDb()
    .select()
    .from(dreamMedia)
    .where(and(eq(dreamMedia.dreamId, dreamId), eq(dreamMedia.mediaType, type), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)))
    .orderBy(desc(dreamMedia.createdAt))
    .limit(1);
  return m;
}

async function nextVersion(dreamId: string, type: MediaType, sceneId?: string | null): Promise<number> {
  const conds = [eq(dreamMedia.dreamId, dreamId), eq(dreamMedia.mediaType, type), isNull(dreamMedia.deletedAt)];
  if (sceneId) conds.push(eq(dreamMedia.sceneId, sceneId));
  const [r] = await getDb()
    .select({ n: count() })
    .from(dreamMedia)
    .where(and(...conds));
  return (r?.n ?? 0) + 1;
}

// ─── Files ──────────────────────────────────────────────────────────────────

export function detectImage(bytes: Buffer): { ext: "png" | "jpg" | "webp" | "gif"; mime: string } {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return { ext: "png", mime: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "GIF8") return { ext: "gif", mime: "image/gif" };
  throw new ProviderError("image", "provider returned an unsupported image format", { retryable: true });
}

function localPathFromFileUrl(url: string): string {
  let p = decodeURI(url.slice("file://".length));
  if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1); // file:///C:/… on Windows
  return p;
}

/**
 * Downloads a provider output (https, data: or — for the demo provider —
 * file://) to a local file. Demo temp dirs are removed after copying.
 */
export async function downloadUrlToFile(url: string, dest: string, provider: string): Promise<void> {
  if (url.startsWith("file://")) {
    const src = localPathFromFileUrl(url);
    await copyFile(src, dest);
    const demoRoot = path.join(workDir(), "demo");
    if (path.resolve(src).startsWith(path.resolve(demoRoot))) await rm(path.dirname(src), { recursive: true, force: true }).catch(() => undefined);
    return;
  }
  const { bytes } = await fetchBytes(provider, url, 10 * 60_000);
  if (bytes.length === 0) throw new ProviderError(provider, "downloaded file is empty", { retryable: true });
  await writeFile(dest, bytes);
}

/** Downloads a stored asset from object storage into the job dir (memoized per dir). */
export async function mediaToLocalFile(m: Pick<MediaRow, "id" | "storageKey" | "format">, dir: string): Promise<string> {
  if (!m.storageKey) throw new ProviderError("storage", `media ${m.id} has no file`, { retryable: false, code: "media_unavailable" });
  const dest = path.join(dir, `${m.id}.${m.format}`);
  try {
    await stat(dest);
    return dest;
  } catch {
    await downloadToFile(m.storageKey, dest);
    return dest;
  }
}

/**
 * Prepares a stored frame as provider input: a signed public URL when the app
 * has a public HTTPS origin, otherwise a base64 JPEG data URI; always also a
 * local JPEG path (used by the demo provider and multipart uploads).
 */
export async function imageInputFor(m: MediaRow, dir: string): Promise<ImageInput> {
  const local = await mediaToLocalFile(m, dir);
  const jpg = path.join(dir, `${m.id}.input.jpg`);
  try {
    await stat(jpg);
  } catch {
    await toJpeg(local, jpg, 1080);
  }
  const url = providerAccessibleUrl(m.id) ?? undefined;
  const dataUri = url ? undefined : `data:image/jpeg;base64,${(await readFile(jpg)).toString("base64")}`;
  return { url, dataUri, filePath: jpg, mime: "image/jpeg" };
}

// ─── Persisting generated assets ────────────────────────────────────────────

export interface StoreImageArgs {
  userId: string;
  dreamId: string;
  sceneId: string | null;
  jobId: string | null;
  type: "image" | "reference";
  bytes: Buffer;
  dir: string;
  provider: string;
  model: string;
  seed?: number | null;
  prompt: string;
  inputHash: string;
  styleId?: string | null;
  characterKey?: string | null;
  isDemo: boolean;
  costUsd: number;
}

export async function storeImage(a: StoreImageArgs): Promise<MediaRow> {
  const id = randomUUID();
  const fmt = detectImage(a.bytes);
  const file = path.join(a.dir, `${id}.${fmt.ext}`);
  await writeFile(file, a.bytes);
  const info = await probe(file).catch(() => null);
  const thumbFile = path.join(a.dir, `${id}.thumb.jpg`);
  await makeThumbnail(file, thumbFile);
  const storageKey = keys.media(a.userId, a.dreamId, id, fmt.ext);
  const thumbnailKey = keys.thumb(a.userId, a.dreamId, id);
  await uploadFile(storageKey, file, fmt.mime);
  await uploadFile(thumbnailKey, thumbFile, "image/jpeg");
  const version = a.type === "image" && a.sceneId ? await nextVersion(a.dreamId, "image", a.sceneId) : 1;
  const [row] = await getDb()
    .insert(dreamMedia)
    .values({
      id,
      dreamId: a.dreamId,
      userId: a.userId,
      sceneId: a.sceneId,
      jobId: a.jobId,
      mediaType: a.type,
      format: fmt.ext,
      storageKey,
      thumbnailKey,
      width: info?.width ?? null,
      height: info?.height ?? null,
      sizeBytes: a.bytes.length,
      status: "ready",
      provider: a.provider,
      model: a.model,
      seed: a.seed ?? null,
      prompt: a.prompt.slice(0, 4000),
      inputHash: a.inputHash,
      styleId: a.styleId ?? null,
      characterKey: a.characterKey ?? null,
      isDemo: a.isDemo,
      costUsd: Number(a.costUsd.toFixed(4)),
      version,
    })
    .returning();
  return row!;
}

export interface StoredVideoFile {
  storageKey: string;
  thumbnailKey: string;
  durationSec: number;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

/** Uploads an MP4 (and a poster thumbnail) for the given media id. */
export async function uploadVideoFile(a: { userId: string; dreamId: string; mediaId: string; file: string; dir: string }): Promise<StoredVideoFile> {
  const info = await probe(a.file);
  if (!info.hasVideo) throw new ProviderError("video", "file has no video stream", { retryable: true });
  const thumbFile = path.join(a.dir, `${a.mediaId}.thumb.jpg`);
  await makeThumbnail(a.file, thumbFile, { isVideo: info.durationSec > 1 });
  const storageKey = keys.media(a.userId, a.dreamId, a.mediaId, "mp4");
  const thumbnailKey = keys.thumb(a.userId, a.dreamId, a.mediaId);
  const { size } = await uploadFile(storageKey, a.file, "video/mp4");
  await uploadFile(thumbnailKey, thumbFile, "image/jpeg");
  return { storageKey, thumbnailKey, durationSec: Math.round(info.durationSec * 100) / 100, width: info.width ?? null, height: info.height ?? null, sizeBytes: size };
}

/** Final slideshow / video result row (new version). */
export async function storeResultVideo(a: {
  userId: string;
  dreamId: string;
  jobId: string;
  type: "slideshow" | "video";
  file: string;
  dir: string;
  model: string;
  styleId: string | null;
  hasWatermark: boolean;
  isDemo: boolean;
}): Promise<MediaRow> {
  const id = randomUUID();
  const stored = await uploadVideoFile({ userId: a.userId, dreamId: a.dreamId, mediaId: id, file: a.file, dir: a.dir });
  const version = await nextVersion(a.dreamId, a.type);
  const [row] = await getDb()
    .insert(dreamMedia)
    .values({
      id,
      dreamId: a.dreamId,
      userId: a.userId,
      jobId: a.jobId,
      mediaType: a.type,
      format: "mp4",
      ...stored,
      status: "ready",
      provider: "ffmpeg",
      model: a.model,
      styleId: a.styleId,
      isDemo: a.isDemo,
      hasWatermark: a.hasWatermark,
      version,
    })
    .returning();
  return row!;
}
