import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDreamDetail } from "@dream/core/services/dreams";
import { startGeneration } from "@dream/core/services/generation";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["image", "video"]), idempotencyKey: z.string().min(8).max(80) });

/** Regenerates one scene (paid separately) without redoing the whole dream. */
export const POST = handler<{ id: string; sceneId: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  const dreamId = UuidParam.parse(params.id);
  const sceneId = UuidParam.parse(params.sceneId);
  const body = await readJson(req, Body);
  const detail = await getDreamDetail(user, dreamId);
  const lastResult = body.kind === "video" ? detail.videos[0] : detail.slideshows[0];
  const job = await startGeneration(user, dreamId, {
    format: body.kind === "video" ? "video" : "slideshow",
    kind: body.kind === "video" ? "scene_video" : "scene_image",
    sceneId,
    styleId: detail.visualStyle ?? "cinematic",
    targetDurationSec: lastResult?.durationSec ? Math.round(lastResult.durationSec) : undefined,
    musicTrackId: null,
    idempotencyKey: body.idempotencyKey,
    locale: userLocale(user),
  });
  return json({ job }, 201);
});
