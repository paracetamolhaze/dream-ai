import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { dreamMedia, dreams, shareLinks, users } from "../db/schema";
import type { ShareLinkDto } from "../dto";
import { publicApiUrl } from "../env";
import { AppError } from "../errors";
import { randomToken } from "../utils";
import { track } from "./analytics";
import { getOwnedDream } from "./dreams";
import { mediaDto } from "./media";
import type { UserRow } from "./users";

/**
 * Share links are created only by an explicit user action and expose exactly
 * one result (plus the title/text only if the owner allows it). Revocable.
 */

function dto(l: typeof shareLinks.$inferSelect): ShareLinkDto {
  return { id: l.id, mediaId: l.mediaId, token: l.token, url: `${publicApiUrl()}/s/${l.token}`, showTitle: l.showTitle, showText: l.showText, views: l.views, createdAt: l.createdAt.toISOString() };
}

export async function createShareLink(user: UserRow, dreamId: string, mediaId: string, opts: { showTitle: boolean; showText: boolean }): Promise<ShareLinkDto> {
  const db = getDb();
  await getOwnedDream(user.id, dreamId);
  const [media] = await db
    .select()
    .from(dreamMedia)
    .where(and(eq(dreamMedia.id, mediaId), eq(dreamMedia.dreamId, dreamId), eq(dreamMedia.userId, user.id), eq(dreamMedia.status, "ready"), isNull(dreamMedia.deletedAt)));
  if (!media || (media.mediaType !== "slideshow" && media.mediaType !== "video")) throw new AppError("not_found", "Result not found");
  const [existing] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.mediaId, mediaId), eq(shareLinks.userId, user.id), isNull(shareLinks.revokedAt)));
  if (existing) {
    const [updated] = await db.update(shareLinks).set({ showTitle: opts.showTitle, showText: opts.showText }).where(eq(shareLinks.id, existing.id)).returning();
    return dto(updated!);
  }
  const [link] = await db.insert(shareLinks).values({ token: randomToken(12), userId: user.id, dreamId, mediaId, showTitle: opts.showTitle, showText: opts.showText }).returning();
  await track("share_link_created", user.id, { type: media.mediaType });
  return dto(link!);
}

export async function listShareLinks(user: UserRow, dreamId: string): Promise<ShareLinkDto[]> {
  const rows = await getDb()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.dreamId, dreamId), eq(shareLinks.userId, user.id), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt));
  return rows.map(dto);
}

export async function revokeShareLink(user: UserRow, linkId: string): Promise<void> {
  const res = await getDb()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.userId, user.id)))
    .returning({ id: shareLinks.id });
  if (res.length === 0) throw new AppError("not_found", "Link not found");
}

/** Public resolution of a share token (no auth). */
export async function resolveShareToken(token: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null;
  const db = getDb();
  const [row] = await db
    .select({ link: shareLinks, media: dreamMedia, title: dreams.title, text: dreams.editedText, deletedAt: dreams.deletedAt, ownerStatus: users.status })
    .from(shareLinks)
    .innerJoin(dreamMedia, eq(dreamMedia.id, shareLinks.mediaId))
    .innerJoin(dreams, eq(dreams.id, shareLinks.dreamId))
    .innerJoin(users, eq(users.id, shareLinks.userId))
    .where(eq(shareLinks.token, token));
  // Links die with the dream, the result, or the owner's account (deletion in progress, ban).
  if (!row || row.link.revokedAt || row.deletedAt || row.media.status !== "ready" || row.media.deletedAt || row.ownerStatus !== "active") return null;
  if (row.link.expiresAt && row.link.expiresAt < new Date()) return null;
  await db.update(shareLinks).set({ views: sql`${shareLinks.views} + 1` }).where(eq(shareLinks.id, row.link.id));
  await track("share_link_viewed", null, { type: row.media.mediaType });
  // Public viewers get a short-lived stream URL only; no download link carrying the dream title.
  const media = { ...mediaDto(row.media), downloadUrl: null };
  return {
    media,
    title: row.link.showTitle ? row.title : null,
    text: row.link.showText ? row.text : null,
  };
}
