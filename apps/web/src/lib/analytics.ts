"use client";

import { api } from "./api";

/**
 * First-party product analytics (stored in our own database, see /api/events).
 * Only event names and small primitive props are sent — never dream content.
 */
export type ClientEvent =
  | "app_open"
  | "start_recording"
  | "recording_completed"
  | "recording_cancelled"
  | "mic_denied"
  | "text_mode_opened"
  | "generation_screen_opened"
  | "slideshow_selected"
  | "video_selected"
  | "checkout_started"
  | "result_opened"
  | "result_downloaded"
  | "result_shared"
  | "referral_link_copied"
  | "library_opened"
  | "library_filter_changed";

type Props = Record<string, string | number | boolean | null>;

const queue: { name: ClientEvent; props: Props }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush(keepalive = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, 25);
  api("/api/events", { method: "POST", body: { events }, keepalive }).catch(() => {
    /* analytics must never break the app */
  });
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => flush(), 2500);
}

export function trackEvent(name: ClientEvent, props: Props = {}): void {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });
    window.addEventListener("pagehide", () => flush(true));
  }
  queue.push({ name, props });
  if (queue.length >= 15) flush();
  else schedule();
}
