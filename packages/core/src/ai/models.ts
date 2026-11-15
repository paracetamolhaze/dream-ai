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

/** Same aspect, short side 1080 px: Seedream bills a flat price up to 2.61 MP, so frames get Full HD for free. */
function fullHd(req: { width: number; height: number }): { width: number; height: number } {
  const k = 1080 / Math.min(req.width, req.height);
  return { width: Math.round((req.width * k) / 8) * 8, height: Math.round((req.height * k) / 8) * 8 };
}

// Prices: fal.ai model pages, checked 2026-11-15. fal bills per-megapixel models in
// 1024×1024 units rounded up, so an 864×1536 frame (1.27 MP) is billed as 2 MP.
export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: "fal:muse-image",
    provider: "fal",
    model: "meta/muse-image/text-to-image",
    label: "Meta Muse Image · fal.ai ($0.01, recommended)",
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.01,
    fallbackId: "fal:flux3-klein",
    buildInput: (req) => ({ prompt: req.prompt, aspect_ratio: aspect(req), num_images: 1, output_format: "jpeg" }),
  },
  {
    id: "fal:muse-image-edit",
    provider: "fal",
    model: "meta/muse-image/edit",
    label: "Meta Muse Image Edit (reference image) · fal.ai ($0.01, recommended)",
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    costPerImageUsd: 0.01,
    fallbackId: "fal:flux3-klein-edit",
    buildInput: (req) => ({ prompt: req.prompt, image_urls: [imageRef(req)], aspect_ratio: aspect(req), num_images: 1, output_format: "jpeg" }),
  },
  {
    id: "fal:flux3-klein",
    provider: "fal",
    model: "blackforestlabs/flux-3/klein/text-to-image",
    label: "FLUX.3 [klein] · fal.ai (~$0.011, budget)",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.011,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      seed: req.seed,
      num_images: 1,
      // Prompts are already composed (character tags must stay verbatim).
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      output_format: "jpeg",
    }),
  },
  {
    id: "fal:flux3-klein-edit",
    provider: "fal",
    model: "blackforestlabs/flux-3/klein/edit-image",
    label: "FLUX.3 [klein] Edit (reference image) · fal.ai (~$0.011, budget)",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    costPerImageUsd: 0.011,
    buildInput: (req) => ({
      prompt: req.prompt,
      image_urls: [imageRef(req)],
      image_size: { width: req.width, height: req.height },
      seed: req.seed,
      num_images: 1,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      output_format: "jpeg",
    }),
  },
  {
    id: "fal:seedream-5.5",
    provider: "fal",
    model: "bytedance/seedream/v5.5/text-to-image",
    label: "Seedream 5.5 · fal.ai ($0.03, premium)",
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.03,
    fallbackId: "fal:flux3-klein",
    buildInput: (req) => ({ prompt: req.prompt, image_size: fullHd(req), num_images: 1, output_format: "jpeg", enable_safety_checker: true }),
  },
  {
    id: "fal:seedream-5.5-edit",
    provider: "fal",
    model: "bytedance/seedream/v5.5/edit",
    label: "Seedream 5.5 Edit (reference image) · fal.ai ($0.042, premium)",
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    // $0.03 per output + $0.012 per input image.
    costPerImageUsd: 0.042,
    fallbackId: "fal:flux3-klein-edit",
    buildInput: (req) => ({ prompt: req.prompt, image_urls: [imageRef(req)], image_size: fullHd(req), num_images: 1, output_format: "jpeg", enable_safety_checker: true }),
  },
  {
    id: "fal:flux-schnell",
    provider: "fal",
    model: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell] · fal.ai",
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsReferenceImage: false,
    costPerImageUsd: 0.006,
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
    costPerImageUsd: 0.05,
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
    costPerImageUsd: 0.04,
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

// Prices: fal.ai model pages, checked 2026-11-15. Resolution is always sent explicitly —
// several models default to 1080p/2K, which costs 2–3× more.
export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    id: "fal:heygen-video",
    provider: "fal",
    model: "heygen/heygen-video/image-to-video",
    label: "HeyGen Video 768p · fal.ai ($0.02/s, recommended)",
    clipDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsSeed: true,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.02,
    buildInput(req, image) {
      // Clips are normalised to the output canvas (cover-crop, audio dropped) when assembled.
      return { prompt: req.prompt, image_url: image, duration: durationFrom(this, req), resolution: "768p", seed: req.seed, enable_safety_checker: true };
    },
  },
  {
    id: "fal:minimax-h3",
    provider: "fal",
    model: "minimax/h3/image-to-video",
    label: "MiniMax H3 768P · fal.ai ($0.06/s, premium)",
    clipDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsSeed: true,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.06,
    buildInput(req, image) {
      // The output canvas follows the start image; the default resolution is 2K ($0.13/s).
      return { prompt: req.prompt, image_url: image, duration: durationFrom(this, req), resolution: "768P", seed: req.seed, enable_safety_checker: true };
    },
  },
  {
    id: "fal:seedance-1-pro-fast",
    provider: "fal",
    model: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
    label: "Seedance 1.0 Pro Fast 720p · fal.ai (~$0.022/s)",
    clipDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsSeed: true,
    imageToVideo: true,
    supportsCancel: true,
    // $1 per 1M video tokens; 720p ≈ 21,600 tokens per second.
    costPerSecondUsd: 0.022,
    buildInput(req, image) {
      // Frames are always portrait (FRAME_W × FRAME_H), so the clip is requested as 9:16.
      return { prompt: req.prompt, image_url: image, aspect_ratio: "9:16", resolution: "720p", duration: String(durationFrom(this, req)), seed: req.seed, camera_fixed: false, enable_safety_checker: true };
    },
  },
  {
    id: "fal:kling-2.1-standard",
    provider: "fal",
    model: "fal-ai/kling-video/v2.1/standard/image-to-video",
    label: "Kling 2.1 Standard · fal.ai (deprecated by fal)",
    clipDurations: [5, 10],
    supportsNegativePrompt: true,
    supportsSeed: false,
    imageToVideo: true,
    supportsCancel: true,
    costPerSecondUsd: 0.056,
    buildInput(req, image) {
      return { prompt: req.prompt, image_url: image, duration: String(durationFrom(this, req)), negative_prompt: req.negativePrompt || "blur, distort, low quality", cfg_scale: 0.5 };
    },
  },
  {
    id: "fal:kling-2.1-master",
    provider: "fal",
    model: "fal-ai/kling-video/v2.1/master/image-to-video",
    label: "Kling 2.1 Master · fal.ai (deprecated by fal)",
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
  /** false: the model does not take the `language` field (it detects the language itself). */
  languageHint?: boolean;
}

// All OpenAI-compatible: Groq models need STT_BASE_URL=https://api.groq.com/openai/v1 and a Groq key in STT_API_KEY.
// OpenAI retires whisper-1 and the gpt-4o transcribe models on 2027-02-26 (replacement: gpt-transcribe).
export const STT_MODELS: SttModelSpec[] = [
  { id: "openai:gpt-transcribe", provider: "openai", model: "gpt-transcribe", label: "gpt-transcribe (OpenAI, recommended)", verboseJson: false, costPerMinuteUsd: 0.0045, languageHint: false },
  { id: "groq:whisper-large-v3", provider: "openai", model: "whisper-large-v3", label: "Groq whisper-large-v3 (cheapest, STT_BASE_URL)", verboseJson: true, costPerMinuteUsd: 0.00185 },
  { id: "groq:whisper-large-v3-turbo", provider: "openai", model: "whisper-large-v3-turbo", label: "Groq whisper-large-v3-turbo (STT_BASE_URL)", verboseJson: true, costPerMinuteUsd: 0.00067 },
  { id: "openai:whisper-1", provider: "openai", model: "whisper-1", label: "Whisper (whisper-1, retired 2027-02-26)", verboseJson: true, costPerMinuteUsd: 0.006 },
  { id: "openai:gpt-4o-transcribe", provider: "openai", model: "gpt-4o-transcribe", label: "gpt-4o-transcribe (retired 2027-02-26)", verboseJson: false, costPerMinuteUsd: 0.006 },
  { id: "openai:gpt-4o-mini-transcribe", provider: "openai", model: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe (retired 2027-02-26)", verboseJson: false, costPerMinuteUsd: 0.003 },
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
