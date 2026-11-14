import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "../db/client";
import { dreamMedia } from "../db/schema";
import type { MediaDto } from "../dto";
import { signMediaUrl } from "../storage";

export type MediaRow = typeof dreamMedia.$inferSelect;

export function mediaDto(m: MediaRow): MediaDto {
  const ready = m.status === "ready" && Boolean(m.storageKey);
  return {
    id: m.id,
    type: m.mediaType,
    status: m.status,
    format: m.format,
    url: ready ? signMediaUrl(m.id) : null,
    thumbUrl: ready && m.thumbnailKey ? signMediaUrl(m.id, { variant: "thumb" }) : ready && (m.mediaType === "image" || m.mediaType === "reference") ? signMediaUrl(m.id) : null,
    downloadUrl: ready ? signMediaUrl(m.id, { download: true, absolute: true }) : null,
    durationSec: m.durationSec,
    width: m.width,
    height: m.height,
    sceneId: m.sceneId,
    isDemo: m.isDemo,
    hasWatermark: m.hasWatermark,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function getMediaByIds(ids: string[], db: DbOrTx = getDb()): Promise<Map<string, MediaRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.select().from(dreamMedia).where(and(inArray(dreamMedia.id, unique), isNull(dreamMedia.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getMedia(id: string, db: DbOrTx = getDb()): Promise<MediaRow | undefined> {
  const [m] = await db.select().from(dreamMedia).where(eq(dreamMedia.id, id));
  return m;
}

/** File name used for downloads: "Город без людей.mp4" */
export function downloadFileName(title: string | null | undefined, m: Pick<MediaRow, "format" | "mediaType" | "version">): string {
  const base = (title ?? "dream").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60) || "dream";
  const suffix = m.mediaType === "slideshow" ? "" : m.mediaType === "video" ? "" : `-${m.mediaType}`;
  return `${base}${suffix}${m.version > 1 ? ` v${m.version}` : ""}.${m.format}`;
}
