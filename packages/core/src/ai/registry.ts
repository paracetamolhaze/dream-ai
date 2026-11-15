import { env } from "../env";
import { ProviderError } from "../errors";
import type { Settings } from "../settings";
import { IMAGE_MODELS, VIDEO_MODELS, findImageModel, findSttModel, findVideoModel } from "./models";
import { AnthropicLlmProvider } from "./providers/anthropic";
import { DemoImageProvider, DemoLlmProvider, DemoSttProvider, DemoVideoProvider } from "./providers/demo";
import { FalImageProvider, FalVideoProvider } from "./providers/fal";
import { OpenRouterImageProvider, OpenRouterVideoProvider, type OpenRouterConn } from "./providers/openrouter";
import { OpenAiImageProvider, OpenAiLlmProvider, OpenAiSttProvider } from "./providers/openai-compatible";
import { ReplicateImageProvider, ReplicateVideoProvider } from "./providers/replicate";
import { RunwayVideoProvider } from "./providers/runway";
import type { ImageProvider, LlmProvider, SttProvider, VideoProvider } from "./types";

/**
 * Resolves the provider selected in admin settings. If its credentials are
 * missing: in DEMO_MODE we fall back to the clearly labelled demo provider;
 * otherwise generation fails with `provider_unavailable` (never silently fake).
 */

function notConfigured(kind: string, what: string): never {
  throw new ProviderError(kind, `${what} is not configured (missing API key)`, { retryable: false, code: "provider_unavailable" });
}

export function credentials() {
  const e = env();
  return {
    openrouter: e.OPENROUTER_API_KEY ? ({ baseUrl: e.OPENROUTER_BASE_URL, apiKey: e.OPENROUTER_API_KEY } satisfies OpenRouterConn) : null,
    openai: e.OPENAI_API_KEY,
    stt: e.STT_API_KEY ?? e.OPENAI_API_KEY,
    sttBase: e.STT_BASE_URL ?? e.OPENAI_BASE_URL,
    llmOpenai: e.LLM_OPENAI_API_KEY ?? e.OPENAI_API_KEY,
    llmOpenaiBase: e.LLM_OPENAI_BASE_URL ?? e.OPENAI_BASE_URL,
    imageOpenai: e.IMAGE_OPENAI_API_KEY ?? e.OPENAI_API_KEY,
    imageOpenaiBase: e.IMAGE_OPENAI_BASE_URL ?? e.OPENAI_BASE_URL,
    anthropic: e.ANTHROPIC_API_KEY,
    fal: e.FAL_KEY,
    replicate: e.REPLICATE_API_TOKEN,
    runway: e.RUNWAY_API_KEY,
  };
}

export function getSttProvider(settings: Settings): SttProvider {
  const sel = settings.models.stt;
  const c = credentials();
  if (sel.provider === "demo") return new DemoSttProvider();
  if (sel.provider === "openrouter") {
    const spec = findSttModel("openrouter", sel.model) ?? { model: sel.model, verboseJson: true, costPerMinuteUsd: 0.0045 };
    if (c.openrouter) return new OpenAiSttProvider(c.openrouter, spec, "openrouter");
    return env().DEMO_MODE ? new DemoSttProvider() : notConfigured("stt", "OpenRouter");
  }
  // A custom STT base URL (e.g. local faster-whisper-server) may not need a key.
  const hasLocal = Boolean(env().STT_BASE_URL);
  if (!c.stt && !hasLocal) return env().DEMO_MODE ? new DemoSttProvider() : notConfigured("stt", "Speech-to-text");
  const spec = findSttModel("openai", sel.model) ?? { model: sel.model, verboseJson: sel.model === "whisper-1", costPerMinuteUsd: 0.006 };
  return new OpenAiSttProvider({ baseUrl: c.sttBase, apiKey: c.stt }, spec);
}

export function getLlmProvider(settings: Settings): LlmProvider {
  const sel = settings.models.llm;
  const c = credentials();
  const g = settings.generation;
  const demo = () => new DemoLlmProvider({ minScenes: g.slideshowMinScenes, maxScenes: g.slideshowMaxScenes });
  if (sel.provider === "demo") return demo();
  if (sel.provider === "openrouter") {
    if (c.openrouter) return new OpenAiLlmProvider(c.openrouter, sel.model, "openrouter");
    return env().DEMO_MODE ? demo() : notConfigured("llm", "OpenRouter");
  }
  if (sel.provider === "anthropic") {
    if (c.anthropic) return new AnthropicLlmProvider(c.anthropic, sel.model);
    return env().DEMO_MODE ? demo() : notConfigured("llm", "Anthropic");
  }
  if (sel.provider === "openai") {
    const hasLocal = Boolean(env().LLM_OPENAI_BASE_URL);
    if (c.llmOpenai || hasLocal) return new OpenAiLlmProvider({ baseUrl: c.llmOpenaiBase, apiKey: c.llmOpenai }, sel.model);
    return env().DEMO_MODE ? demo() : notConfigured("llm", "OpenAI-compatible LLM");
  }
  return env().DEMO_MODE ? demo() : notConfigured("llm", `LLM provider ${sel.provider}`);
}

export function getImageProvider(modelId: string): ImageProvider {
  const spec = findImageModel(modelId);
  if (!spec) throw new ProviderError("image", `unknown image model ${modelId}`, { retryable: false });
  const c = credentials();
  const fallback = () => (env().DEMO_MODE ? new DemoImageProvider() : notConfigured("image", spec.label));
  switch (spec.provider) {
    case "demo":
      return new DemoImageProvider();
    case "openrouter":
      return c.openrouter ? new OpenRouterImageProvider(c.openrouter, spec) : fallback();
    case "fal":
      return c.fal ? new FalImageProvider(c.fal, spec) : fallback();
    case "replicate":
      return c.replicate ? new ReplicateImageProvider(c.replicate, spec) : fallback();
    case "openai":
      return c.imageOpenai || env().IMAGE_OPENAI_BASE_URL ? new OpenAiImageProvider({ baseUrl: c.imageOpenaiBase, apiKey: c.imageOpenai }, spec) : fallback();
  }
}

export function getVideoProvider(modelId: string): VideoProvider {
  const spec = findVideoModel(modelId);
  if (!spec) throw new ProviderError("video", `unknown video model ${modelId}`, { retryable: false });
  const c = credentials();
  const fallback = () => (env().DEMO_MODE ? new DemoVideoProvider() : notConfigured("video", spec.label));
  switch (spec.provider) {
    case "demo":
      return new DemoVideoProvider();
    case "openrouter":
      return c.openrouter ? new OpenRouterVideoProvider(c.openrouter, spec) : fallback();
    case "fal":
      return c.fal ? new FalVideoProvider(c.fal, spec) : fallback();
    case "replicate":
      return c.replicate ? new ReplicateVideoProvider(c.replicate, spec) : fallback();
    case "runway":
      return c.runway ? new RunwayVideoProvider(c.runway, spec) : fallback();
  }
}

/** Video model spec that will actually be used (demo fallback included) — for duration planning. */
export function effectiveVideoSpec(settings: Settings) {
  try {
    return getVideoProvider(settings.models.video.model).spec;
  } catch {
    return findVideoModel(settings.models.video.model) ?? VIDEO_MODELS[0]!;
  }
}

/** Whether a selection would run in demo mode (for UI badges and job flags). */
export function isDemoSelection(settings: Settings): { stt: boolean; llm: boolean; image: boolean; video: boolean } {
  const safe = (fn: () => { isDemo: boolean }) => {
    try {
      return fn().isDemo;
    } catch {
      return false;
    }
  };
  return {
    stt: safe(() => getSttProvider(settings)),
    llm: safe(() => getLlmProvider(settings)),
    image: safe(() => getImageProvider(settings.models.image.model)),
    video: safe(() => getVideoProvider(settings.models.video.model)),
  };
}

function mask(v?: string): string | null {
  if (!v) return null;
  return v.length <= 8 ? "••••" : `${v.slice(0, 3)}…${v.slice(-4)}`;
}

/** Credential status for the admin "Models" page — never exposes full keys. */
export function credentialStatus() {
  const e = env();
  return [
    { name: "OPENAI_API_KEY", usedFor: "STT (Whisper), OpenAI-compatible LLM & images", masked: mask(e.OPENAI_API_KEY) },
    { name: "STT_BASE_URL", usedFor: "Local/compatible STT server (faster-whisper)", masked: e.STT_BASE_URL ?? null },
    { name: "LLM_OPENAI_BASE_URL", usedFor: "OpenAI-compatible LLM server", masked: e.LLM_OPENAI_BASE_URL ?? null },
    { name: "ANTHROPIC_API_KEY", usedFor: "Claude (dream analysis)", masked: mask(e.ANTHROPIC_API_KEY) },
    { name: "FAL_KEY", usedFor: "fal.ai images & video", masked: mask(e.FAL_KEY) },
    { name: "REPLICATE_API_TOKEN", usedFor: "Replicate images & video", masked: mask(e.REPLICATE_API_TOKEN) },
    { name: "RUNWAY_API_KEY", usedFor: "Runway video", masked: mask(e.RUNWAY_API_KEY) },
    { name: "IMAGE_OPENAI_BASE_URL", usedFor: "Local/compatible image server", masked: e.IMAGE_OPENAI_BASE_URL ?? null },
  ];
}

export { IMAGE_MODELS, VIDEO_MODELS };
