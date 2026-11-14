#!/usr/bin/env node
/**
 * End-to-end smoke test of the main user journey through the real HTTP API
 * (requires ALLOW_DEV_AUTH=true on the target, i.e. development/staging only):
 *
 *   voice upload → transcription → review/confirm → analysis → slideshow →
 *   download (Range) → library tab "slideshow" → promo credits → AI video →
 *   library tab "video" → the same single dream has both results.
 *
 * Usage:  node scripts/e2e-smoke.mjs [baseUrl]        (default http://localhost:3000)
 * Env:    E2E_DATABASE_URL — used only to create a one-off promo code for the video step.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const BASE = (process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DB = process.env.E2E_DATABASE_URL ?? "postgres://dream:dream@localhost:5432/dream";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s]`, ...a);

let auth = "";
async function api(method, p, body, extra = {}) {
  const headers = { authorization: `tma ${auth}`, ...(extra.headers ?? {}) };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok && !extra.allowError) throw new Error(`${method} ${p} → ${res.status} ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data)}`);
  return { status: res.status, data };
}

async function poll(label, fn, done, timeoutMs = 10 * 60_000, everyMs = 2000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (done(last)) return last;
    await sleep(everyMs);
  }
  throw new Error(`${label}: timed out; last = ${JSON.stringify(last).slice(0, 400)}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  log("✓", msg);
}

async function main() {
  log("target", BASE);
  const tgId = 900_000_000_000 + Math.floor(Math.random() * 99_000_000_000);
  const dev = await fetch(`${BASE}/api/auth/dev?id=${tgId}&name=E2E&lang=ru`);
  if (!dev.ok) throw new Error(`dev auth unavailable (${dev.status}) — set ALLOW_DEV_AUTH=true on a non-production deployment`);
  auth = (await dev.json()).initData;
  const session = (await api("POST", "/api/session", {})).data;
  assert(session.user.telegramId === tgId, "1-2. new user opened the Mini App (session created)");

  // 3-5. Record & upload a voice message (a short synthetic OGG/Opus like Telegram voice notes).
  const dir = mkdtempSync(path.join(os.tmpdir(), "dream-e2e-"));
  const ogg = path.join(dir, "dream.ogg");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libopus", ogg]);
  const form = new FormData();
  form.set("audio", new Blob([readFileSync(ogg)], { type: "audio/ogg" }), "dream.ogg");
  form.set("durationSec", "3");
  const created = (await api("POST", "/api/dreams/voice", form)).data.dream;
  assert(created.status === "transcribing", "5. recording stopped and uploaded → transcribing");

  const reviewed = await poll("transcription", async () => (await api("GET", `/api/dreams/${created.id}`)).data, (d) => d.status !== "transcribing", 5 * 60_000);
  assert(reviewed.status === "review", `6. transcript ready for review (demo STT: ${reviewed.transcriptionIsDemo})`);

  const text =
    "Мне приснилось, что я был в огромном заброшенном городе. Небо было красным. Я шёл по пустой улице между стеклянными башнями. " +
    "Потом я встретил человека без лица, который молча показал мне светящуюся дверь в другое измерение. Я открыл её и увидел океан.";
  await api("POST", `/api/dreams/${created.id}/confirm`, { text });
  const analyzed = await poll("analysis", async () => (await api("GET", `/api/dreams/${created.id}`)).data, (d) => d.status === "ready" || d.status === "analysis_failed", 5 * 60_000);
  assert(analyzed.status === "ready" && analyzed.scenes.length > 0, `6. text confirmed, story analyzed: «${analyzed.title}», ${analyzed.scenes.length} scenes`);

  // 7-8. Choose slideshow and start generation.
  const quote = (await api("GET", `/api/dreams/${created.id}/quote`)).data;
  log("quote: slideshow", quote.slideshow, "video options", quote.video.options.map((o) => `${o.actualSec}s/${o.credits}cr`).join(", "));
  const slideJob = (await api("POST", `/api/dreams/${created.id}/generate`, { format: "slideshow", styleId: "cinematic", musicTrackId: quote.music[0]?.id ?? null, idempotencyKey: `e2e-s-${tgId}` })).data.job;
  assert(slideJob.status === "queued", `7-8. slideshow generation started (free: ${slideJob.usedFreeAllowance}, credits: ${slideJob.creditsCost})`);
  // 9. "Close the Mini App" — nothing to do: generation runs on the server.
  const slideDone = await poll("slideshow job", async () => (await api("GET", `/api/jobs/${slideJob.id}`)).data, (j) => ["completed", "failed", "cancelled"].includes(j.status), 15 * 60_000, 3000);
  assert(slideDone.status === "completed", `10. slideshow completed (progress ${slideDone.progress}%)`);

  // 11-12. Open the result and download the MP4 (with HTTP Range, like a <video> element).
  const detail = (await api("GET", `/api/dreams/${created.id}`)).data;
  const slideshow = detail.slideshows[0];
  assert(slideshow && slideshow.url, "11. result available on the dream page");
  const ranged = await fetch(`${BASE}${slideshow.url}`, { headers: { range: "bytes=0-1023" } });
  assert(ranged.status === 206 && (ranged.headers.get("content-type") ?? "").includes("video/mp4"), "11. video streams with Range support");
  const full = await fetch(slideshow.downloadUrl.startsWith("http") ? slideshow.downloadUrl : `${BASE}${slideshow.downloadUrl}`);
  const bytes = Buffer.from(await full.arrayBuffer());
  assert(full.ok && bytes.subarray(4, 8).toString() === "ftyp", `12. MP4 downloaded (${(bytes.length / 1024).toFixed(0)} KB, ${slideshow.durationSec?.toFixed(1)} s)`);
  const tampered = await fetch(`${BASE}${slideshow.url.replace(/sig=[^&]+/, "sig=AAAA")}`);
  assert(tampered.status === 403, "private media: tampered signature rejected");

  // 13-14. Library → "Slideshow" tab.
  const slidesTab = (await api("GET", "/api/dreams?tab=slideshow")).data;
  assert(slidesTab.items.some((i) => i.id === created.id), "13-14. dream is listed in «Слайд-шоу»");

  // 15-16. Same dream → create the AI video (credits via a one-off promo code).
  const promoCode = `E2E${tgId}`;
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  await client.query("insert into promo_codes (code, credits, max_redemptions, note) values ($1, 500, 1, 'e2e smoke') on conflict do nothing", [promoCode]);
  await client.end();
  const redeemed = (await api("POST", "/api/profile/promo", { code: promoCode })).data;
  assert(redeemed.credits === 500, `promo redeemed: balance ${redeemed.balance}`);
  const quote2 = (await api("GET", `/api/dreams/${created.id}/quote`)).data;
  const option = quote2.video.options[0];
  assert(option, `video duration options offered: ${quote2.video.options.map((o) => o.actualSec).join("/")} s (${quote2.video.modelLabel})`);
  const videoJob = (await api("POST", `/api/dreams/${created.id}/generate`, { format: "video", styleId: "cinematic", targetDurationSec: option.targetSec, idempotencyKey: `e2e-v-${tgId}` })).data.job;
  assert(videoJob.creditState === "reserved", `16. video generation started, ${videoJob.creditsCost} credits reserved`);
  const videoDone = await poll("video job", async () => (await api("GET", `/api/jobs/${videoJob.id}`)).data, (j) => ["completed", "failed", "cancelled"].includes(j.status), 30 * 60_000, 4000);
  assert(videoDone.status === "completed" && videoDone.creditState === "captured", "17. video completed, credits captured");

  // 17-18. Library tabs and single-dream invariant.
  const videoTab = (await api("GET", "/api/dreams?tab=video")).data;
  assert(videoTab.items.some((i) => i.id === created.id), "17. dream is listed in «Видео»");
  const all = (await api("GET", "/api/dreams?tab=all")).data;
  assert(all.items.filter((i) => i.id === created.id).length === 1 && all.stats.total === 1, "18. still exactly one dream record");
  const finalDetail = (await api("GET", `/api/dreams/${created.id}`)).data;
  assert(finalDetail.slideshows.length >= 1 && finalDetail.videos.length >= 1, "18. the dream has both a slideshow and a video");
  log("✅ E2E journey passed", { dreamId: created.id, demo: { stt: reviewed.transcriptionIsDemo, llm: analyzed.analysisIsDemo, slideshow: slideshow.isDemo, video: finalDetail.videos[0].isDemo } });
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
