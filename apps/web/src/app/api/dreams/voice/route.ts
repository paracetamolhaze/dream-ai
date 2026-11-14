import type { NextRequest } from "next/server";
import { createVoiceDream, getDreamDetail } from "@dream/core/services/dreams";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { readAudioUpload } from "@/server/upload";

export const dynamic = "force-dynamic";

/** Voice recording from the Mini App → stored privately → transcription job. */
export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 20 });
  const { bytes, durationSec } = await readAudioUpload(req);
  const dream = await createVoiceDream(user, bytes, { source: "miniapp_voice", durationHintSec: durationSec });
  return json({ dream: await getDreamDetail(user, dream.id) }, 201);
});
