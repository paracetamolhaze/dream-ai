import "server-only";
import type { NextRequest } from "next/server";
import { env } from "@dream/core/env";
import { AppError } from "@dream/core/errors";

/** Reads an audio file from multipart form data with size limits enforced before buffering. */
export async function readAudioUpload(req: NextRequest, field = "audio"): Promise<{ bytes: Buffer; durationSec?: number; form: FormData }> {
  const max = env().MAX_AUDIO_BYTES;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max + 64 * 1024) throw new AppError("audio_too_large", "Recording too large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("validation_failed", "Expected multipart/form-data");
  }
  const file = form.get(field);
  if (!file || typeof file === "string") throw new AppError("audio_empty", "Audio file missing");
  if (file.size > max) throw new AppError("audio_too_large", "Recording too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  const d = Number(form.get("durationSec"));
  return { bytes, durationSec: Number.isFinite(d) && d > 0 ? d : undefined, form };
}
