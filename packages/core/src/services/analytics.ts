import { getDb, type DbOrTx } from "../db/client";
import { analyticsEvents } from "../db/schema";
import { logger } from "../logger";

/** Events accepted from the client. Server-side events can use any name below as well. */
export const CLIENT_EVENTS = [
  "app_open",
  "start_recording",
  "recording_completed",
  "recording_cancelled",
  "mic_denied",
  "text_mode_opened",
  "generation_screen_opened",
  "slideshow_selected",
  "video_selected",
  "checkout_started",
  "result_opened",
  "result_downloaded",
  "result_shared",
  "referral_link_copied",
  "library_opened",
  "library_filter_changed",
] as const;

export const SERVER_EVENTS = [
  "user_registered",
  "referral_opened",
  "transcription_completed",
  "transcription_failed",
  "dream_created",
  "analysis_completed",
  "generation_started",
  "generation_completed",
  "generation_failed",
  "purchase_completed",
  "payment_refunded",
  "promo_redeemed",
  "share_link_created",
  "share_link_viewed",
  "account_deleted",
] as const;

export type AnalyticsEventName = (typeof CLIENT_EVENTS)[number] | (typeof SERVER_EVENTS)[number];

/** Strips anything that looks like free text so no dream content lands in analytics. */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props).slice(0, 20)) {
    if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 80);
  }
  return out;
}

export async function track(name: AnalyticsEventName, userId: string | null | undefined, props: Record<string, unknown> = {}, opts: { source?: string; db?: DbOrTx } = {}): Promise<void> {
  try {
    await (opts.db ?? getDb()).insert(analyticsEvents).values({ name, userId: userId ?? null, props: sanitizeProps(props), source: opts.source ?? "server" });
  } catch (err) {
    logger.warn("analytics insert failed", { name, error: (err as Error).message });
  }
}
