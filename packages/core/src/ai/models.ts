import type { ImageModelSpec, ImageRequest, VideoModelSpec, VideoRequest } from "./types";

/**
 * Model capability catalog. Each entry declares only what the provider's
 * public API documents — seed / negative prompt / reference image support,
 * accepted clip durations — and how a generic request maps to the provider's
 * input schema. Add new models here (or extend via the admin "Models" page,
 * which selects among these ids).
 *
 * Costs are approximate list prices used for budgeting and analytics; actual
 * billing is on the provider side.
 */

/** Picks the provider-documented aspect string closest to the request. */
function aspect(req: { width: number; height: number }): string {
  const r = req.width / req.height;
  if (r < 0.62) return "9:16";
  if (r < 0.9) return "3:4";
  if (r < 1.1) return "1:1";
  return "16:9";
}

function imageRef(req: ImageRequest): string | undefined {
  return req.referenceImage?.url ?? req.referenceImage?.dataUri;
}

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: "fal:flux-schnell",
    provider: "fal",
    model: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell] · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.004,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      num_inference_steps: 4,
      num_images: 1,
      seed: req.seed,
      enable_safety_checker: true,
    }),
  },
  {
    id: "fal:flux-dev",
    provider: "fal",
    model: "fal-ai/flux/dev",
    label: "FLUX.1 [dev] · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.035,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      seed: req.seed,
      enable_safety_checker: true,
    }),
  },
  {
    id: "fal:flux-kontext-pro",
    provider: "fal",
    model: "fal-ai/flux-pro/kontext",
    label: "FLUX.1 Kontext [pro] (reference image) · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    costPerImageUsd: 0.04,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: imageRef(req),
      aspect_ratio: aspect(req),
      seed: req.seed,
      guidance_scale: 3.5,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "2",
    }),
  },
  {
    id: "fal:qwen-image",
    provider: "fal",
    model: "fal-ai/qwen-image",
    label: "Qwen-Image · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsReferenceImage: false,
    costPerImageUsd: 0.03,
    buildInput: (req) => ({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt || undefined,
      image_size: { width: req.width, height: req.height },
      num_images: 1,
      seed: req.seed,
      enable_safety_checker: true,
    }),
  },
  {
    id: "fal:qwen-image-edit",
    provider: "fal",
    model: "fal-ai/qwen-image-edit",
    label: "Qwen-Image Edit (reference image) · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    costPerImageUsd: 0.03,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_url: imageRef(req),
      negative_prompt: req.negativePrompt || undefined,
      image_size: { width: req.width, height: req.height },
      num_images: 1,
      seed: req.seed,
      output_format: "jpeg",
      enable_safety_checker: true,
    }),
  },
  {
    id: "replicate:flux-schnell",
    provider: "replicate",
    model: "black-forest-labs/flux-schnell",
    label: "FLUX.1 [schnell] · Replicate",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.003,
    buildInput: (req) => ({ prompt: req.prompt, aspect_ratio: aspect(req), seed: req.seed, num_outputs: 1, output_format: "jpg", output_quality: 92 }),
  },
  {
    id: "replicate:flux-dev",
    provider: "replicate",
    model: "black-forest-labs/flux-dev",
    label: "FLUX.1 [dev] · Replicate",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.025,
    buildInput: (req) => ({ prompt: req.prompt, aspect_ratio: aspect(req), seed: req.seed, num_outputs: 1, output_format: "jpg", output_quality: 92, guidance: 3.5 }),
  },
  {
    id: "replicate:flux-kontext-pro",
    provider: "replicate",
    model: "black-forest-labs/flux-kontext-pro",
    label: "FLUX.1 Kontext [pro] (reference image) · Replicate",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    costPerImageUsd: 0.04,
    buildInput: (req) => ({ prompt: req.prompt, input_image: imageRef(req), aspect_ratio: aspect(req), seed: req.seed, output_format: "jpg", safety_tolerance: 2 }),
  },
  {
    id: "openai:gpt-image-1",
    provider: "openai",
    model: "gpt-image-1",
    label: "gpt-image-1 · OpenAI-compatible",
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    costPerImageUsd: 0.063,
    buildInput: (req) => ({ prompt: req.prompt, size: req.height > req.width ? "1024x1536" : req.width > req.height ? "1536x1024" : "1024x1024", quality: "medium", n: 1 }),
  },
  {
    id: "demo:image",
    provider: "demo",
    model: "demo-gradient",
    label: "DEMO — procedural frames (no AI)",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0,
    buildInput: (req) => ({ ...req }),
  },
];

function durationFrom(spec: { clipDurations: number[] }, req: VideoRequest): number {
  // Snap to the nearest supported duration — never request unsupported lengths.
  return spec.clipDurations.reduce((best, d) => (Math.abs(d - req.durationSec) < Math.abs(best - req.durationSec) ? d : best), spec.clipDurations[0]!);
}

export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    id: "fal:kling-2.1-standard",
    provider: "fal",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    label: "Kling 2.1 Standard · fal.ai",
    clipDurations: [5, 10],
    supportsNegativePrompt: true,
    supportsSeed: false,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.05,
    buildInput(req, image) {
      return { prompt: req.prompt, image_url: image, duration: String(durationFrom(this, req)), negative_prompt: req.negativePrompt || "blur, distort, low quality", cfg_scale: 0.5 };
    },
  },
  {
    id: "fal:kling-2.1-master",
    provider: "fal",
    model: "fal-ai/kling-video/v2.1/master/image-to-video",
    label: "Kling 2.1 Master · fal.ai (premium)",
    clipDurations: [5, 10],
    supportsNegativePrompt: true,
    supportsSeed: false,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.28,
    buildInput(req, image) {
      return { prompt: req.prompt, image_url: image, duration: String(durationFrom(this, req)), negative_prompt: req.negativePrompt || "blur, distort, low quality", cfg_scale: 0.5 };
    },
  },
  {
    id: "fal:hailuo-02-standard",
    provider: "fal",
    model: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    label: "MiniMax Hailuo-02 Standard · fal.ai",
    clipDurations: [6, 10],
    supportsNegativePrompt: false,
    supportsSeed: false,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.045,
    buildInput(req, image) {
      return { prompt: req.prompt, image_url: image, duration: String(durationFrom(this, req)), prompt_optimizer: true };
    },
  },
  // Replicate video models can be added here (ReplicateVideoProvider is generic) once their
  // input schema is confirmed on the model's API page — entries are not added speculatively.
  {
    id: "runway:gen4-turbo",
    provider: "runway",
    model: "gen4_turbo",
    label: "Runway Gen-4 Turbo",
    clipDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsSeed: true,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.05,
    buildInput(req, image) {
      return { model: "gen4_turbo", promptImage: image, promptText: req.prompt.slice(0, 1000), ratio: "720:1280", duration: durationFrom(this, req), seed: req.seed };
    },
  },
  {
    id: "demo:video",
    provider: "demo",
    model: "demo-kenburns",
    label: "DEMO — camera motion over frames (no AI)",
    clipDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsSeed: false,
    imageToVideo: true,
    supportsCancel: false,
    costPerSecondUsd: 0,
    buildInput(req) {
      return { ...req, durationSec: durationFrom(this, req) };
    },
  },
];

export interface SttModelSpec {
  id: string;
  provider: "openai" | "demo";
  model: string;
  label: string;
  verboseJson: boolean;
  costPerMinuteUsd: number;
}

export const STT_MODELS: SttModelSpec[] = [
  { id: "openai:whisper-1", provider: "openai", model: "whisper-1", label: "Whisper (whisper-1)", verboseJson: true, costPerMinuteUsd: 0.006 },
  { id: "openai:gpt-4o-transcribe", provider: "openai", model: "gpt-4o-transcribe", label: "gpt-4o-transcribe", verboseJson: false, costPerMinuteUsd: 0.006 },
  { id: "openai:gpt-4o-mini-transcribe", provider: "openai", model: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", verboseJson: false, costPerMinuteUsd: 0.003 },
  { id: "demo:stt", provider: "demo", model: "demo", label: "DEMO — no recognition", verboseJson: false, costPerMinuteUsd: 0 },
];

export interface LlmModelSpec {
  provider: "anthropic" | "openai" | "demo";
  model: string;
  label: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export const LLM_MODELS: LlmModelSpec[] = [
  { provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTokUsd: 4, outputPerMTokUsd: 20 },
  { provider: "anthropic", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  { provider: "anthropic", model: "claude-haiku-5-5", label: "Claude Haiku 5.5", inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5 },
  { provider: "openai", model: "gpt-4.1-mini", label: "OpenAI-compatible (any model name)", inputPerMTokUsd: 0.4, outputPerMTokUsd: 1.6 },
  { provider: "demo", model: "demo", label: "DEMO — heuristic scene split (no AI)", inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
];

export function findImageModel(id: string): ImageModelSpec | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}
export function findVideoModel(id: string): VideoModelSpec | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}
export function findSttModel(provider: string, model: string): SttModelSpec | undefined {
  return STT_MODELS.find((m) => m.provider === provider && m.model === model);
}
export function llmPricing(provider: string, model: string): LlmModelSpec | undefined {
  return LLM_MODELS.find((m) => m.provider === provider && m.model === model) ?? LLM_MODELS.find((m) => m.provider === provider);
}
