"use client";

import { useRef } from "react";
import type { StartGenerationBody } from "@dream/core/dto";
import { safeSession, saveSession, uuid } from "./utils";

type Options = Omit<StartGenerationBody, "idempotencyKey">;

/**
 * Keeps one idempotency key per distinct set of options, so double taps and
 * network retries of the same click never create two paid jobs, while a
 * deliberate new attempt with other options gets a fresh key.
 */
export function useIdempotencyKey() {
  const ref = useRef<{ sig: string; key: string } | null>(null);
  return {
    keyFor(options: Options): string {
      const sig = JSON.stringify(options);
      if (!ref.current || ref.current.sig !== sig) ref.current = { sig, key: uuid() };
      return ref.current.key;
    },
    reset() {
      ref.current = null;
    },
  };
}

const jobKey = (jobId: string) => `dream.job.${jobId}`;

/** Remembers the options of a started job (for "try again" after a failure). */
export function rememberJobOptions(jobId: string, body: StartGenerationBody): void {
  const { idempotencyKey: _omit, ...options } = body;
  void _omit;
  saveSession(jobKey(jobId), options);
}

export function recallJobOptions(jobId: string): Options | null {
  return safeSession<Options | null>(jobKey(jobId), null);
}
