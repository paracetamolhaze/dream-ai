import { describe, expect, it, vi } from "vitest";

// The fallback is resolved through the registry; tests swap in fake providers and skip usage logging.
const { fakeProviders } = vi.hoisted(() => ({ fakeProviders: new Map<string, unknown>() }));
vi.mock("../src/ai/registry", () => ({
  getImageProvider: (id: string) => {
    const p = fakeProviders.get(id);
    if (!p) throw new Error(`unknown image model ${id}`);
    return p;
  },
}));
vi.mock("../src/services/ai-usage", () => ({ recordUsage: async () => undefined }));

import { IMAGE_MODELS, LLM_MODELS, STT_MODELS, findImageModel, findVideoModel } from "../src/ai/models";
import type { ImageModelSpec, ImageRequest } from "../src/ai/types";
import { ProviderError } from "../src/errors";
import { callImageProvider } from "../src/pipeline/frames";
import { defaultSettings } from "../src/settings";

const frame: ImageRequest = { prompt: "a lighthouse in fog", width: 864, height: 1536, seed: 7, referenceImage: { url: "https://cdn.example/ref.jpg" } };

describe("model catalogue", () => {
  it("default selections exist and fit their roles", () => {
    const m = defaultSettings().models;
    expect(findImageModel(m.image.model)?.requiresReferenceImage).toBeFalsy();
    expect(findImageModel(m.image.referenceModel!)?.supportsReferenceImage).toBe(true);
    expect(findVideoModel(m.video.model)).toBeDefined();
    expect(STT_MODELS.some((s) => s.provider === m.stt.provider && s.model === m.stt.model)).toBe(true);
    expect(LLM_MODELS.some((l) => l.provider === m.llm.provider && l.model === m.llm.model)).toBe(true);
  });

  it("routes every default step through OpenRouter (one key)", () => {
    const m = defaultSettings().models;
    expect([m.stt.provider, m.llm.provider, findImageModel(m.image.model)!.provider, findImageModel(m.image.referenceModel!)!.provider, findVideoModel(m.video.model)!.provider]).toEqual(Array(5).fill("openrouter"));
    expect(m.llm.model).toBe("anthropic/claude-haiku-5.5");
  });

  it("fallbacks are real models with the same reference contract and no chains", () => {
    const withFallback = IMAGE_MODELS.filter((s) => s.fallbackId);
    expect(withFallback.length).toBeGreaterThan(0);
    for (const spec of withFallback) {
      const fb = findImageModel(spec.fallbackId!);
      expect(fb, spec.id).toBeDefined();
      expect(fb!.provider).not.toBe("demo");
      expect(Boolean(fb!.requiresReferenceImage)).toBe(Boolean(spec.requiresReferenceImage));
      expect(fb!.fallbackId).toBeUndefined();
    }
  });

  it("asks for vertical frames and the cheap resolutions explicitly", () => {
    expect(findImageModel("fal:muse-image")!.buildInput(frame)).toMatchObject({ aspect_ratio: "9:16", num_images: 1 });
    expect(findImageModel("fal:muse-image-edit")!.buildInput(frame)).toMatchObject({ image_urls: ["https://cdn.example/ref.jpg"], aspect_ratio: "9:16" });
    expect(findImageModel("fal:flux3-klein-edit")!.buildInput(frame)).toMatchObject({ image_size: { width: 864, height: 1536 }, seed: 7, enable_prompt_expansion: false });
    // Seedream bills a flat $0.03 up to 2.61 MP → Full HD costs the same as the frame size.
    expect(findImageModel("fal:seedream-5.5")!.buildInput(frame)).toMatchObject({ image_size: { width: 1080, height: 1920 } });

    const clip = { prompt: "slow push in", durationSec: 7, image: {}, seed: 3 };
    expect(findVideoModel("fal:heygen-video")!.buildInput(clip, "https://cdn.example/f.jpg")).toMatchObject({ resolution: "768p", duration: 5, image_url: "https://cdn.example/f.jpg" });
    expect(findVideoModel("fal:minimax-h3")!.buildInput({ ...clip, durationSec: 10 }, "u")).toMatchObject({ resolution: "768P", duration: 10 });
    expect(findVideoModel("fal:seedance-1-pro-fast")!.buildInput(clip, "u")).toMatchObject({ aspect_ratio: "9:16", resolution: "720p", duration: "5" });
  });
});

describe("image fallback", () => {
  const provider = (spec: ImageModelSpec, generate: () => Promise<unknown>, isDemo = false) => ({ spec, isDemo, generate: vi.fn(generate) });
  const refuses = () => Promise.reject(new ProviderError("fal", "prompt declined", { retryable: false, code: "provider_rejected_content" }));

  it("draws the frame with the fallback model when the primary refuses", async () => {
    const muse = provider(findImageModel("fal:muse-image-edit")!, refuses);
    const klein = provider(findImageModel("fal:flux3-klein-edit")!, async () => ({ bytes: Buffer.from("klein"), costUsd: 0.011 }));
    fakeProviders.set("fal:flux3-klein-edit", klein);
    const out = await callImageProvider(muse as never, frame, {});
    expect(out.provider).toBe(klein);
    expect(out.bytes.toString()).toBe("klein");
    expect(muse.generate).toHaveBeenCalledTimes(1); // a refusal is not retried in place
  });

  it("never falls back to demo frames", async () => {
    const muse = provider(findImageModel("fal:muse-image")!, refuses);
    fakeProviders.set("fal:flux3-klein", provider(findImageModel("fal:flux3-klein")!, async () => ({ bytes: Buffer.from("x"), costUsd: 0 }), true));
    await expect(callImageProvider(muse as never, frame, {})).rejects.toThrow(/prompt declined/);
  });
});
