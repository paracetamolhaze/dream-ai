import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../../env";
import { demoImage, kenBurnsClip, cameraMoveFromHint } from "../../media/ffmpeg";
import { clamp, randomToken } from "../../utils";
import type { DreamAnalysis } from "../analysis";
import { findImageModel, findVideoModel } from "../models";
import type {
  AiCallContext,
  ImageProvider,
  ImageRequest,
  ImageResult,
  LlmProvider,
  StructuredRequest,
  StructuredResult,
  SttInput,
  SttProvider,
  SttResult,
  VideoProvider,
  VideoRequest,
  VideoTaskStatus,
} from "../types";

/**
 * DEMO MODE providers. They let the whole pipeline run end-to-end without
 * paid API keys, and every output is explicitly labelled as demo:
 *  - STT returns a placeholder the user must edit (no speech recognition)
 *  - LLM splits the text heuristically (no AI)
 *  - Images are procedural gradients stamped "DEMO · NOT AI GENERATED"
 *  - Video clips are Ken Burns moves over those frames
 */

export function workDir(): string {
  return env().WORK_DIR ?? path.join(os.tmpdir(), "dream-ai");
}

export class DemoSttProvider implements SttProvider {
  readonly id = "demo";
  readonly model = "demo";
  readonly isDemo = true;
  async transcribe(input: SttInput, _ctx: AiCallContext): Promise<SttResult> {
    const ru = input.language !== "en";
    return {
      text: ru
        ? "[ДЕМО-РЕЖИМ] Распознавание речи не подключено, поэтому здесь нет текста вашей записи. Опишите сон своими словами в этом поле — например: «Мне приснился огромный заброшенный город под красным небом…»"
        : "[DEMO MODE] Speech recognition is not configured, so this is not your recording's text. Describe your dream in this field — e.g. “I dreamed of a huge abandoned city under a red sky…”",
      language: ru ? "ru" : "en",
      durationSec: input.durationSec,
      costUsd: 0,
    };
  }
}

function sentences(text: string): string[] {
  return text
    .replace(/\[(ДЕМО-РЕЖИМ|DEMO MODE)\][^.]*\./g, "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function heuristicAnalysis(text: string, opts: { minScenes: number; maxScenes: number }): DreamAnalysis {
  const cyr = (text.match(/[а-яё]/gi) ?? []).length;
  const lat = (text.match(/[a-z]/gi) ?? []).length;
  const ru = cyr >= lat;
  const parts = sentences(text);
  const count = clamp(Math.ceil(parts.length / 2), Math.min(opts.minScenes, Math.max(1, parts.length)), opts.maxScenes);
  const groups: string[][] = Array.from({ length: Math.max(1, count) }, () => []);
  parts.forEach((p, i) => groups[Math.min(groups.length - 1, Math.floor((i * groups.length) / Math.max(1, parts.length)))]!.push(p));
  const firstWords = (parts[0] ?? text).split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(" ");
  const title = firstWords ? firstWords.charAt(0).toUpperCase() + firstWords.slice(1).replace(/[.,!?…]+$/, "") : ru ? "Сон" : "Dream";
  const hasDreamer = /(^|\s)(я|мне|меня|мной|i|me|my)(\s|,|$)/i.test(text);
  const cams = ["wide shot", "medium shot", "close-up", "low angle", "over-the-shoulder", "aerial shot"];
  return {
    title,
    summary: (parts[0] ?? text).slice(0, 200),
    language: ru ? "ru" : "en",
    atmosphere: ru ? "демо-режим" : "demo mode",
    mood: "dreamlike",
    suggestedStyle: "cinematic",
    style: { palette: "deep blue, violet, soft lavender", lighting: "moonlight", lens: "35mm", texture: "soft film grain", mood: "dreamlike" },
    characters: hasDreamer
      ? [
          {
            key: "dreamer",
            name: ru ? "Я" : "Me",
            role: "protagonist",
            appearance: "silhouette of a person",
            hair: "",
            clothing: "dark coat",
            distinctiveFeatures: "",
            age: "",
            palette: "dark blue",
            visualTag: "a lone silhouetted figure in a dark coat",
          },
        ]
      : [],
    locations: [
      { key: "dreamscape", name: ru ? "Место сна" : "Dreamscape", description: "dream place", architecture: "", lighting: "moonlight", timeOfDay: "night", weather: "", atmosphere: "misty", visualTag: "a misty dreamscape" },
    ],
    scenes: groups
      .filter((g) => g.length > 0)
      .map((g, i) => {
        const desc = g.join(" ");
        return {
          title: desc.split(/\s+/).slice(0, 4).join(" "),
          description: desc,
          action: desc,
          mood: "dreamlike",
          characters: hasDreamer ? ["dreamer"] : [],
          location: "dreamscape",
          cameraAngle: cams[i % cams.length]!,
          composition: "centered vertical composition",
          motion: ["slow push in", "gentle pan right", "slow pull back", "tilt up"][i % 4]!,
          imagePrompt: `[DEMO] ${desc}`,
          videoPrompt: "[DEMO] slow camera drift",
          negativePrompt: "",
          importance: 2,
        };
      }),
  };
}

export class DemoLlmProvider implements LlmProvider {
  readonly id = "demo";
  readonly model = "demo";
  readonly isDemo = true;
  constructor(private readonly opts: { minScenes: number; maxScenes: number }) {}

  async generateStructured<T>(req: StructuredRequest<T>, _ctx: AiCallContext): Promise<StructuredResult<T>> {
    const m = /<dream>\n?([\s\S]*?)\n?<\/dream>/.exec(req.user);
    const analysis = heuristicAnalysis(m?.[1] ?? req.user, this.opts);
    const parsed = req.schema.parse(analysis);
    return { data: parsed, costUsd: 0 };
  }
}

export class DemoImageProvider implements ImageProvider {
  readonly isDemo = true;
  readonly spec = findImageModel("demo:image")!;

  async generate(req: ImageRequest, _ctx: AiCallContext): Promise<ImageResult> {
    const dir = path.join(workDir(), "demo", randomToken(6));
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, "frame.jpg");
    const caption = (req.label ?? req.prompt).replace(/^\[DEMO\]\s*/, "");
    try {
      await demoImage(out, { width: req.width, height: req.height, seed: req.seed ?? 7, title: "DREAM AI", caption, workDir: dir });
      return { bytes: await readFile(out), contentType: "image/jpeg", seed: req.seed, costUsd: 0 };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Demo video: renders the clip locally at submit time; status returns a file:// URL. */
export class DemoVideoProvider implements VideoProvider {
  readonly isDemo = true;
  readonly spec = findVideoModel("demo:video")!;

  async submit(req: VideoRequest, _ctx: AiCallContext): Promise<{ externalId: string }> {
    if (!req.image.filePath) throw new Error("demo video provider needs a local start frame");
    const dir = path.join(workDir(), "demo", randomToken(6));
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, "clip.mp4");
    const duration = (this.spec.buildInput(req, "") as { durationSec: number }).durationSec;
    await kenBurnsClip(req.image.filePath, out, {
      width: 720,
      height: 1280,
      fps: 30,
      durationSec: duration,
      move: cameraMoveFromHint(req.prompt, Math.floor(Math.random() * 6)),
      label: "DEMO · NOT AI VIDEO",
      workDir: dir,
    });
    return { externalId: JSON.stringify({ file: out }) };
  }

  async getStatus(externalId: string): Promise<VideoTaskStatus> {
    const { file } = JSON.parse(externalId) as { file: string };
    return { state: "succeeded", videoUrl: `file://${file}` };
  }
}
