import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "@dream/core/env";
import { getDb } from "@dream/core/db/client";
import { dreamMedia, dreams, musicTracks } from "@dream/core/db/schema";
import { downloadFileName } from "@dream/core/services/media";
import { getObjectStream, presignGet, verifyMediaSignature } from "@dream/core/storage";

export const dynamic = "force-dynamic";

/**
 * Private media delivery. Access is granted only by a short-lived HMAC-signed
 * URL (issued to the owner inside authenticated API responses). Supports HTTP
 * Range so <video> can seek and stream. The bucket itself stays private.
 */

interface Target {
  key: string;
  contentType: string;
  fileName: string;
}

const CT: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp3: "audio/mpeg", ogg: "audio/ogg", webm: "audio/webm", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac" };

function extOf(key: string): string {
  return key.split(".").pop()?.toLowerCase() ?? "";
}

async function resolveTarget(id: string, variant: "file" | "thumb"): Promise<Target | null> {
  const db = getDb();
  if (id.startsWith("audio-")) {
    const dreamId = id.slice(6);
    const [d] = await db.select().from(dreams).where(and(eq(dreams.id, dreamId), isNull(dreams.deletedAt))).catch(() => []);
    if (!d?.originalAudioKey || d.audioDeletedAt) return null;
    return { key: d.originalAudioKey, contentType: d.audioMime ?? CT[extOf(d.originalAudioKey)] ?? "application/octet-stream", fileName: `dream-audio.${extOf(d.originalAudioKey)}` };
  }
  if (id.startsWith("music-")) {
    const [t] = await db.select().from(musicTracks).where(eq(musicTracks.id, id.slice(6))).catch(() => []);
    if (!t || !t.isActive) return null;
    return { key: t.storageKey, contentType: CT[extOf(t.storageKey)] ?? "audio/mpeg", fileName: `${t.title}.${extOf(t.storageKey)}` };
  }
  const [row] = await db
    .select({ media: dreamMedia, title: dreams.title, deletedAt: dreams.deletedAt })
    .from(dreamMedia)
    .innerJoin(dreams, eq(dreams.id, dreamMedia.dreamId))
    .where(eq(dreamMedia.id, id))
    .catch(() => []);
  if (!row || row.deletedAt || row.media.deletedAt || row.media.status !== "ready") return null;
  const key = variant === "thumb" ? row.media.thumbnailKey ?? row.media.storageKey : row.media.storageKey;
  if (!key) return null;
  return { key, contentType: CT[extOf(key)] ?? "application/octet-stream", fileName: variant === "thumb" ? "thumb.jpg" : downloadFileName(row.title, row.media) };
}

function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^((audio|music)-)?[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const sig = verifyMediaSignature(id, req.nextUrl.searchParams);
  if (!sig.ok) return new Response("Link expired", { status: 403, headers: { "cache-control": "no-store" } });
  const target = await resolveTarget(id, sig.variant);
  if (!target) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

  if (env().MEDIA_DELIVERY === "redirect") {
    const url = await presignGet(target.key, 3600, sig.download ? target.fileName : undefined);
    return Response.redirect(url, 302);
  }

  const range = req.headers.get("range") ?? undefined;
  try {
    const obj = await getObjectStream(target.key, range && /^bytes=\d*-\d*$/.test(range) ? range : undefined);
    const headers = new Headers({
      "content-type": target.contentType,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      // Inline (shared/streamed) responses never carry the dream title; only the owner's download does.
      "content-disposition": contentDisposition(sig.download ? target.fileName : `dream.${extOf(target.key) || "bin"}`, sig.download),
      "x-content-type-options": "nosniff",
    });
    if (obj.contentLength !== undefined) headers.set("content-length", String(obj.contentLength));
    if (obj.contentRange) headers.set("content-range", obj.contentRange);
    if (obj.etag) headers.set("etag", obj.etag);
    const body = Readable.toWeb(obj.body) as ReadableStream<Uint8Array>;
    return new Response(body, { status: obj.contentRange ? 206 : 200, headers });
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 416) return new Response("Range not satisfiable", { status: 416 });
    if (status === 404) return new Response("Not found", { status: 404 });
    throw err;
  }
}
