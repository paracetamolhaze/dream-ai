"use client";

import type { UploadVoiceResponse } from "@dream/core/dto";
import { upload } from "./api";
import type { RecordingResult } from "./recorder";

export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("aac")) return "aac";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "webm";
}

/** Uploads a recording as multipart (`audio`, `durationSec`) with real progress. */
export function uploadVoice(path: string, rec: RecordingResult, onProgress?: (f: number) => void): Promise<UploadVoiceResponse> {
  const form = new FormData();
  form.set("audio", rec.blob, `dream.${extFromMime(rec.mime)}`);
  form.set("durationSec", String(Math.max(1, Math.round(rec.durationMs / 1000))));
  return upload<UploadVoiceResponse>(path, form, onProgress);
}
