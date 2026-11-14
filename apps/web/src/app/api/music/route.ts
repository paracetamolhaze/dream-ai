import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@dream/core/db/client";
import { musicTracks } from "@dream/core/db/schema";
import type { MusicTrackDto } from "@dream/core/dto";
import { AppError } from "@dream/core/errors";
import { validateAudioUpload } from "@dream/core/services/dreams";
import { keys, putObject, signMediaUrl } from "@dream/core/storage";
import { sanitizeUserText } from "@dream/core/utils";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { readAudioUpload } from "@/server/upload";

export const dynamic = "force-dynamic";

const MAX_OWN_TRACKS = 10;

/** Upload of the user's own background music (stored privately, visible only to them). */
export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 10 });
  const { bytes, form, durationSec } = await readAudioUpload(req);
  const fmt = validateAudioUpload(bytes);
  const db = getDb();
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(musicTracks).where(and(eq(musicTracks.ownerUserId, user.id), eq(musicTracks.isActive, true)));
  if (n >= MAX_OWN_TRACKS) throw new AppError("rate_limited", "Too many uploaded tracks");
  const rawTitle = form.get("title");
  const title = sanitizeUserText(typeof rawTitle === "string" ? rawTitle : "").replace(/\n/g, " ").slice(0, 60) || "Моя музыка";
  const id = randomUUID();
  const key = keys.userMusic(user.id, id, fmt.ext);
  await putObject(key, bytes, fmt.mime);
  const [track] = await db
    .insert(musicTracks)
    .values({ id, ownerUserId: user.id, title, license: "user-provided", storageKey: key, durationSec: durationSec ?? null, isGenerated: false })
    .returning();
  const dto: MusicTrackDto = { id: track!.id, title: track!.title, artist: null, durationSec: track!.durationSec, isOwn: true, isGenerated: false, previewUrl: signMediaUrl(`music-${track!.id}`) };
  return json(dto, 201);
});
