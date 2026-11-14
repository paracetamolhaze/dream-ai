import type { NextRequest } from "next/server";
import { getDreamDetail, replaceDreamAudio } from "@dream/core/services/dreams";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { UuidParam } from "@/server/schemas";
import { readAudioUpload } from "@/server/upload";

export const dynamic = "force-dynamic";

/** Re-record: replaces the dream's audio and transcribes again. */
export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 20 });
  const id = UuidParam.parse(params.id);
  const { bytes, durationSec } = await readAudioUpload(req);
  await replaceDreamAudio(user, id, bytes, durationSec);
  return json({ dream: await getDreamDetail(user, id) });
});
