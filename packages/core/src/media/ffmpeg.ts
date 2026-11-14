import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { clamp } from "../utils";

export class FfmpegError extends Error {
  constructor(message: string, readonly stderrTail: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function run(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new FfmpegError(`${path.basename(bin)} timed out after ${opts.timeoutMs}ms`, stderr.slice(-2000)));
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new FfmpegError(`${path.basename(bin)} failed to start: ${err.message}`, ""));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${path.basename(bin)} exited with code ${code}`, stderr.slice(-2000)));
    });
  });
}

export function ffmpeg(args: string[], opts: RunOptions = {}) {
  return run(env().FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeoutMs: 15 * 60_000, ...opts });
}

export interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  formatName?: string;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env().FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  const json = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
  };
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(json.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    formatName: json.format?.format_name,
  };
}

// ─── Fonts & text (drawtext) ────────────────────────────────────────────────

const FONT_CANDIDATES = [
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "C:/Windows/Fonts/segoeui.ttf",
];

let fontCache: string | null | undefined;
export function fontFile(): string | null {
  if (fontCache !== undefined) return fontCache;
  const configured = env().FONT_PATH;
  const found = [configured, ...FONT_CANDIDATES].find((p): p is string => Boolean(p && existsSync(p)));
  fontCache = found ?? null;
  return fontCache;
}

/** Escapes a filesystem path for use inside an FFmpeg filter option value. */
function filterPath(p: string): string {
  return `'${p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`;
}

async function textFile(workDir: string, name: string, text: string): Promise<string> {
  const p = path.join(workDir, `${name}.txt`);
  await writeFile(p, text, "utf8");
  return p;
}

const CENTER_Y = "(h-text_h)/2";

/**
 * Builds drawtext filter(s). Multi-line text is drawn one line per filter:
 * FFmpeg 8's drawtext renders a missing-glyph box for "\n" in text files.
 * `y` may be CENTER_Y to vertically center the whole block.
 */
async function drawText(workDir: string, name: string, text: string, opts: { size: number; x: string; y: string; alpha?: number; box?: boolean }): Promise<string | null> {
  const font = fontFile();
  if (!font) return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const lineHeight = Math.round(opts.size * 1.32);
  const filters: string[] = [];
  for (const [i, line] of lines.entries()) {
    const tf = await textFile(workDir, `${name}-${i}`, line);
    const y = lines.length === 1 ? opts.y : opts.y === CENTER_Y ? `(h-${lines.length * lineHeight})/2+${i * lineHeight}` : `${opts.y}+${i * lineHeight}`;
    const parts = [
      `fontfile=${filterPath(font)}`,
      `textfile=${filterPath(tf)}`,
      `fontsize=${opts.size}`,
      `fontcolor=white@${opts.alpha ?? 0.85}`,
      `x=${opts.x}`,
      `y=${y}`,
      "shadowcolor=black@0.45",
      "shadowx=2",
      "shadowy=2",
    ];
    if (opts.box) parts.push("box=1", "boxcolor=black@0.35", "boxborderw=18");
    filters.push(`drawtext=${parts.join(":")}`);
  }
  return filters.join(",");
}

// ─── Audio ──────────────────────────────────────────────────────────────────

/**
 * Peak/mean loudness via the `volumedetect` filter (dBFS). Used to reject
 * silent recordings before paying for speech recognition.
 */
export async function measureVolume(file: string, opts: RunOptions = {}): Promise<{ meanDb: number | null; maxDb: number | null }> {
  // volumedetect prints at info level, so this bypasses the quiet `ffmpeg()` wrapper.
  const { stderr } = await run(env().FFMPEG_PATH, ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { timeoutMs: 3 * 60_000, ...opts });
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  const num = (v?: string) => (v === undefined ? null : v === "-inf" ? -Infinity : Number(v));
  return { meanDb: num(mean), maxDb: num(max) };
}

/** Normalizes any recording to mono 16 kHz MP3 — a format every STT API accepts. */
export async function transcodeForStt(input: string, output: string): Promise<void> {
  await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", output], { timeoutMs: 5 * 60_000 });
}

/** Procedurally generated ambient pad (license-free background music). */
export async function generateAmbientTrack(output: string, variant: number, durationSec = 120): Promise<void> {
  const chords = [
    [110, 164.81, 220, 277.18], // A major-ish pad
    [98, 146.83, 196, 233.08], // G minor
    [130.81, 196, 261.63, 311.13], // C minor
  ];
  const f = chords[variant % chords.length]!;
  const expr = f
    .map((hz, i) => `${(0.07 - i * 0.01).toFixed(3)}*sin(2*PI*${hz}*t)*(0.65+0.35*sin(2*PI*${(0.05 + i * 0.03).toFixed(2)}*t))`)
    .join("+");
  await ffmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `aevalsrc='${expr}':s=44100:d=${durationSec}`,
      "-af",
      `aecho=0.8:0.85:90|160:0.35|0.25,lowpass=f=1600,afade=t=in:st=0:d=4,afade=t=out:st=${durationSec - 6}:d=6,volume=1.6`,
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "160k",
      output,
    ],
    { timeoutMs: 3 * 60_000 },
  );
}

// ─── Images ─────────────────────────────────────────────────────────────────

export async function makeThumbnail(input: string, output: string, opts: { isVideo?: boolean; width?: number } = {}): Promise<void> {
  const w = opts.width ?? 405;
  const args = opts.isVideo ? ["-ss", "0.8", "-i", input] : ["-i", input];
  await ffmpeg([...args, "-frames:v", "1", "-vf", `scale=${w}:-2:flags=lanczos`, "-q:v", "4", output], { timeoutMs: 60_000 });
}

/** Re-encodes an image to a reasonably small JPEG (for data URIs / uploads to providers). */
export async function toJpeg(input: string, output: string, maxWidth = 1080): Promise<void> {
  await ffmpeg(["-i", input, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2:flags=lanczos`, "-q:v", "3", output], { timeoutMs: 60_000 });
}

const DEMO_PALETTES = [
  ["0x0b0a1f", "0x3b2a7a", "0x8f7bd6", "0x1c3d5a"],
  ["0x090d1a", "0x14385c", "0x6aa7c9", "0x2b1748"],
  ["0x120914", "0x5a1f3b", "0xd77a8f", "0x241046"],
  ["0x060b10", "0x0f3a3a", "0x6fc2b0", "0x1b2149"],
  ["0x0d0a06", "0x4a2f12", "0xd8a45b", "0x2a1636"],
];

/**
 * DEMO MODE frame: a procedural gradient with an explicit "DEMO" label and
 * the scene text. It is intentionally obvious that this is not AI output.
 */
export async function demoImage(output: string, opts: { width: number; height: number; seed: number; title: string; caption: string; workDir: string }): Promise<void> {
  await mkdir(opts.workDir, { recursive: true });
  const pal = DEMO_PALETTES[opts.seed % DEMO_PALETTES.length]!;
  const r = (n: number) => ((opts.seed >> n) & 0xff) / 255;
  const w = opts.width;
  const h = opts.height;
  const filters: string[] = [`noise=alls=${6 + Math.round(r(3) * 6)}:allf=t`, "gblur=sigma=1.2"];
  const label = await drawText(opts.workDir, `demo-label-${opts.seed}`, "DEMO · NOT AI GENERATED", { size: Math.round(w * 0.032), x: "(w-text_w)/2", y: `${Math.round(h * 0.06)}`, alpha: 0.9, box: true });
  if (label) filters.push(label);
  const wrapped = wrapText(opts.caption, 30).slice(0, 7).join("\n");
  const caption = await drawText(opts.workDir, `demo-caption-${opts.seed}`, wrapped, { size: Math.round(w * 0.045), x: "(w-text_w)/2", y: CENTER_Y, alpha: 0.92 });
  if (caption) filters.push(caption);
  const title = await drawText(opts.workDir, `demo-title-${opts.seed}`, opts.title, { size: Math.round(w * 0.038), x: "(w-text_w)/2", y: `h-${Math.round(h * 0.12)}`, alpha: 0.75 });
  if (title) filters.push(title);
  await ffmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${w}x${h}:c0=${pal[0]}:c1=${pal[1]}:c2=${pal[2]}:c3=${pal[3]}:nb_colors=4:x0=${Math.round(r(0) * w)}:y0=0:x1=${Math.round(r(8) * w)}:y1=${h}:seed=${opts.seed % 100000}:d=1`,
      "-frames:v",
      "1",
      "-vf",
      filters.join(","),
      "-q:v",
      "2",
      output,
    ],
    { timeoutMs: 60_000 },
  );
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ─── Video ──────────────────────────────────────────────────────────────────

export type CameraMove = "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "static";

export function cameraMoveFromHint(hint: string | null | undefined, index: number): CameraMove {
  const h = (hint ?? "").toLowerCase();
  if (/zoom[\s_-]*out|pull[\s_-]*back|dolly[\s_-]*out|отдал/.test(h)) return "zoom_out";
  if (/zoom|push|dolly[\s_-]*in|прибл/.test(h)) return "zoom_in";
  if (/pan[\s_-]*left|truck[\s_-]*left|влево/.test(h)) return "pan_left";
  if (/pan|truck|track|вправо/.test(h)) return "pan_right";
  if (/tilt[\s_-]*up|crane[\s_-]*up|rise|вверх/.test(h)) return "pan_up";
  if (/tilt|crane|down|вниз/.test(h)) return "pan_down";
  if (/static|still/.test(h)) return "static";
  const cycle: CameraMove[] = ["zoom_in", "pan_right", "zoom_out", "pan_up", "pan_left", "zoom_in"];
  return cycle[index % cycle.length]!;
}

/** zoompan expressions for a gentle Ken Burns move over `frames` frames. */
function zoompanExpr(move: CameraMove, frames: number): { z: string; x: string; y: string } {
  const zMax = 1.14;
  const inc = ((zMax - 1) / frames).toFixed(6);
  const center = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  switch (move) {
    case "zoom_in":
      return { z: `min(1+on*${inc},${zMax})`, ...center };
    case "zoom_out":
      return { z: `max(${zMax}-on*${inc},1)`, ...center };
    case "pan_left":
      return { z: "1.12", x: `(iw-iw/zoom)*(1-on/${frames})`, y: center.y };
    case "pan_right":
      return { z: "1.12", x: `(iw-iw/zoom)*(on/${frames})`, y: center.y };
    case "pan_up":
      return { z: "1.12", x: center.x, y: `(ih-ih/zoom)*(1-on/${frames})` };
    case "pan_down":
      return { z: "1.12", x: center.x, y: `(ih-ih/zoom)*(on/${frames})` };
    default:
      return { z: "1.02", ...center };
  }
}

export interface Canvas {
  width: number;
  height: number;
  fps: number;
}

/** Renders a still frame into a moving clip with a Ken Burns camera move. */
export async function kenBurnsClip(image: string, output: string, opts: Canvas & { durationSec: number; move: CameraMove; label?: string | null; workDir?: string }, run?: RunOptions): Promise<void> {
  const frames = Math.max(1, Math.round(opts.durationSec * opts.fps));
  const { z, x, y } = zoompanExpr(opts.move, frames);
  // Upscale the source first to avoid zoompan jitter from integer rounding.
  const sw = Math.round(opts.width * 1.5);
  const sh = Math.round(opts.height * 1.5);
  const filters = [
    `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${sw}:${sh}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${opts.width}x${opts.height}:fps=${opts.fps}`,
  ];
  if (opts.label && opts.workDir) {
    const dt = await drawText(opts.workDir, `clip-label-${path.basename(output)}`, opts.label, { size: Math.round(opts.width * 0.03), x: "(w-text_w)/2", y: `${Math.round(opts.height * 0.06)}`, alpha: 0.9, box: true });
    if (dt) filters.push(dt);
  }
  filters.push("setsar=1", "format=yuv420p");
  await ffmpeg(
    ["-i", image, "-vf", filters.join(","), "-frames:v", String(frames), "-r", String(opts.fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-an", output],
    { timeoutMs: 10 * 60_000, ...run },
  );
}

/**
 * Scales/crops a provider clip to the canvas and trims it to `durationSec`.
 * If the clip is shorter than requested (providers return e.g. 4.96 s for "5 s",
 * and cross-fades need a little overlap), its last frame is held to fill the gap.
 */
export async function normalizeClip(input: string, output: string, opts: Canvas & { durationSec: number }, run?: RunOptions): Promise<void> {
  const vf = [
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${opts.width}:${opts.height}`,
    "tpad=stop_mode=clone:stop_duration=3",
    `fps=${opts.fps}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  await ffmpeg(["-i", input, "-t", opts.durationSec.toFixed(3), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-an", output], { timeoutMs: 10 * 60_000, ...run });
}

export interface AssembleInput {
  clips: { path: string; durationSec: number }[];
  output: string;
  canvas: Canvas;
  transitionSec: number;
  musicPath?: string | null;
  watermarkText?: string | null;
  workDir: string;
}

/**
 * Joins normalized clips with cross-fades, adds optional music (looped and
 * faded) and a subtle watermark. Produces an H.264/AAC MP4 with faststart.
 * Each clip must already be at least (durationSec + transitionSec) long
 * except the last one.
 */
export async function assemble(input: AssembleInput, run?: RunOptions): Promise<{ durationSec: number }> {
  const { clips, canvas } = input;
  if (clips.length === 0) throw new Error("assemble: no clips");
  const t = clips.length > 1 ? clamp(input.transitionSec, 0, 1.5) : 0;
  const args: string[] = [];
  for (const c of clips) args.push("-i", c.path);
  const musicIndex = clips.length;
  if (input.musicPath) args.push("-stream_loop", "-1", "-i", input.musicPath);

  const graph: string[] = [];
  // xfade: offset_k = sum(L_0..L_{k-1}) - k*t ; output length = sum(L) - (n-1)*t
  let last = "[0:v]";
  let acc = 0;
  for (let i = 1; i < clips.length; i++) {
    acc += clips[i - 1]!.durationSec;
    const offset = acc - i * t;
    const out = `[x${i}]`;
    graph.push(`${last}[${i}:v]xfade=transition=fade:duration=${t.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}${out}`);
    last = out;
  }
  const total = clips.reduce((s, c) => s + c.durationSec, 0) - (clips.length - 1) * t;
  const fadeOut = Math.max(0, total - 0.8);
  let vChain = `${last}fade=t=in:st=0:d=0.6,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.8`;
  if (input.watermarkText) {
    const dt = await drawText(input.workDir, "watermark", input.watermarkText, { size: Math.round(canvas.width * 0.026), x: "w-text_w-36", y: "h-text_h-48", alpha: 0.55 });
    if (dt) vChain += `,${dt}`;
  }
  vChain += ",format=yuv420p[vout]";
  graph.push(vChain);
  if (input.musicPath) {
    graph.push(`[${musicIndex}:a]atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5,volume=0.85[aout]`);
  }
  args.push("-filter_complex", graph.join(";"), "-map", "[vout]");
  if (input.musicPath) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  else args.push("-an");
  args.push("-t", total.toFixed(3), "-r", String(canvas.fps), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.output);
  await ffmpeg(args, { timeoutMs: 20 * 60_000, ...run });
  return { durationSec: total };
}
