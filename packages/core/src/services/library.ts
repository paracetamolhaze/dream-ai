import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { ACTIVE_JOB_STATUSES, dreamMedia, dreams, generationJobs } from "../db/schema";
import type { CardStatus, DreamCardDto, LibraryPageDto, LibraryStatsDto, OutputFormat } from "../dto";
import { AppError } from "../errors";
import { truncate } from "../utils";
import { mediaDto, type MediaRow } from "./media";

export interface LibraryQuery {
  tab: "all" | "slideshow" | "video";
  sort: "new" | "old";
  favorites?: boolean;
  status?: "ready" | "processing";
  q?: string;
  cursor?: string | null;
  limit?: number;
}

// Fully qualified on purpose: drizzle renders bare column names inside SELECT expressions.
const DREAM_ID = sql.raw(`"dreams"."id"`);
const activeList = sql.raw(ACTIVE_JOB_STATUSES.map((s) => `'${s}'`).join(","));

/** EXISTS: the dream has a finished result of this format, or one is being generated. */
function hasFormat(format: OutputFormat): SQL {
  return sql`(exists (select 1 from ${dreamMedia} m where m.dream_id = ${DREAM_ID} and m.media_type = ${format} and m.status = 'ready' and m.deleted_at is null)
    or exists (select 1 from ${generationJobs} j where j.dream_id = ${DREAM_ID} and j.media_type = ${format} and j.status in (${activeList})))`;
}

const hasReadyResult = sql`exists (select 1 from ${dreamMedia} m where m.dream_id = ${DREAM_ID} and m.media_type in ('slideshow','video') and m.status = 'ready' and m.deleted_at is null)`;
const isProcessing = sql`(${dreams.status} in ('transcribing','analyzing') or exists (select 1 from ${generationJobs} j where j.dream_id = ${DREAM_ID} and j.status in (${activeList})))`;

// Cursor = exact DB timestamp (microseconds; JS Date would truncate to ms and repeat/skip rows) + id.
const EXACT_TS = sql<string>`to_char(${dreams.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`).toString("base64url");
}

function decodeCursor(c: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(c, "base64url").toString().split("|");
  if (!id || !ts || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(ts) || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("validation_failed", "Invalid cursor");
  return { ts, id };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function libraryStats(userId: string): Promise<LibraryStatsDto> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      slideshows: sql<number>`count(*) filter (where exists (select 1 from ${dreamMedia} m where m.dream_id = ${DREAM_ID} and m.media_type = 'slideshow' and m.status = 'ready' and m.deleted_at is null))::int`,
      videos: sql<number>`count(*) filter (where exists (select 1 from ${dreamMedia} m where m.dream_id = ${DREAM_ID} and m.media_type = 'video' and m.status = 'ready' and m.deleted_at is null))::int`,
    })
    .from(dreams)
    .where(and(eq(dreams.userId, userId), isNull(dreams.deletedAt)));
  return { total: row?.total ?? 0, slideshows: row?.slideshows ?? 0, videos: row?.videos ?? 0 };
}

export async function listLibrary(userId: string, q: LibraryQuery): Promise<LibraryPageDto> {
  const db = getDb();
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
  const conds: SQL[] = [eq(dreams.userId, userId), isNull(dreams.deletedAt)];
  if (q.tab === "slideshow") conds.push(hasFormat("slideshow"));
  if (q.tab === "video") conds.push(hasFormat("video"));
  if (q.favorites) conds.push(eq(dreams.isFavorite, true));
  if (q.status === "ready") conds.push(hasReadyResult);
  if (q.status === "processing") conds.push(isProcessing);
  const search = q.q?.trim();
  if (search) {
    const pattern = `%${escapeLike(search.slice(0, 100))}%`;
    conds.push(sql`(${dreams.title} ilike ${pattern} or ${dreams.editedText} ilike ${pattern} or ${dreams.summary} ilike ${pattern})`);
  }
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      q.sort === "old"
        ? sql`(${dreams.createdAt}, ${dreams.id}) > (${c.ts}::timestamptz, ${c.id}::uuid)`
        : sql`(${dreams.createdAt}, ${dreams.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`,
    );
  }
  const order = q.sort === "old" ? [asc(dreams.createdAt), asc(dreams.id)] : [desc(dreams.createdAt), desc(dreams.id)];
  const raw = await db
    .select({ dream: dreams, cursorTs: EXACT_TS })
    .from(dreams)
    .where(and(...conds))
    .orderBy(...order)
    .limit(limit + 1);
  const rows = raw.map((r) => r.dream);
  const page = rows.slice(0, limit);
  const nextCursor = raw.length > limit ? encodeCursor(raw[limit - 1]!.cursorTs, page[page.length - 1]!.id) : null;
  const ids = page.map((d) => d.id);

  const [media, jobs, stats] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(dreamMedia)
          .where(and(inArray(dreamMedia.dreamId, ids), isNull(dreamMedia.deletedAt), eq(dreamMedia.status, "ready"), inArray(dreamMedia.mediaType, ["slideshow", "video", "image"])))
          .orderBy(desc(dreamMedia.createdAt))
      : Promise.resolve([] as MediaRow[]),
    ids.length
      ? db
          .select()
          .from(generationJobs)
          .where(inArray(generationJobs.dreamId, ids))
          .orderBy(desc(generationJobs.createdAt))
      : Promise.resolve([] as (typeof generationJobs.$inferSelect)[]),
    libraryStats(userId),
  ]);

  const items: DreamCardDto[] = page.map((d) => {
    const dm = media.filter((m) => m.dreamId === d.id);
    const results = dm.filter((m) => m.mediaType === "slideshow" || m.mediaType === "video");
    const latest = results[0];
    const dj = jobs.filter((j) => j.dreamId === d.id);
    const active = dj.find((j) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status));
    const coverRow = dm.find((m) => m.id === d.coverMediaId) ?? dm.find((m) => m.mediaType === "image") ?? latest;
    const cover = coverRow ? mediaDto(coverRow) : null;
    const lastJob = dj[0];
    let status: CardStatus;
    if (d.status === "transcribing" || d.status === "analyzing" || active) status = "processing";
    else if (latest) status = "ready";
    else if (d.status === "transcription_failed" || d.status === "analysis_failed" || lastJob?.status === "failed") status = "failed";
    else if (d.status === "ready") status = "awaiting";
    else status = "draft";
    const formats = {
      slideshow: results.some((m) => m.mediaType === "slideshow") || dj.some((j) => j.mediaType === "slideshow" && (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status)),
      video: results.some((m) => m.mediaType === "video") || dj.some((j) => j.mediaType === "video" && (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status)),
    };
    const preferred = q.tab === "slideshow" || q.tab === "video" ? results.find((m) => m.mediaType === q.tab) ?? latest : latest;
    return {
      id: d.id,
      title: d.title,
      createdAt: d.createdAt.toISOString(),
      status,
      dreamStatus: d.status,
      cover: cover ? { url: cover.thumbUrl ?? cover.url, thumbUrl: cover.thumbUrl } : null,
      formats,
      primaryFormat: (preferred?.mediaType as OutputFormat | undefined) ?? (active?.mediaType ?? null),
      durationSec: preferred?.durationSec ?? null,
      isFavorite: d.isFavorite,
      activeJob: active ? { id: active.id, mediaType: active.mediaType, progress: active.progress, status: active.status } : null,
      excerpt: truncate((d.summary ?? d.editedText ?? "").replace(/\s+/g, " "), 140),
    };
  });

  return { items, nextCursor, stats };
}
