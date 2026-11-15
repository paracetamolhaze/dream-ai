import { afterEach, describe, expect, it, vi } from "vitest";
import { findImageModel, findVideoModel } from "../src/ai/models";
import { OpenRouterImageProvider, OpenRouterVideoProvider } from "../src/ai/providers/openrouter";

const conn = { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-test" };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter catalog entries", () => {
  const frame = { prompt: "a lighthouse in fog", width: 864, height: 1536, seed: 7 };

  it("builds Image API bodies: vertical, 1.5K tier, references only for edit models", () => {
    const t2i = findImageModel("or:seedream-5.5")!.buildInput(frame);
    expect(t2i).toMatchObject({ model: "bytedance-seed/seedream-5-5", aspect_ratio: "9:16", resolution: "1.5K", output_format: "jpeg", n: 1, seed: 7 });
    expect(t2i).not.toHaveProperty("input_references");
    const edit = findImageModel("or:seedream-5.5-edit")!.buildInput({ ...frame, referenceImage: { url: "https://api.example/m/ref" } });
    expect(edit).toMatchObject({ input_references: [{ type: "image_url", image_url: { url: "https://api.example/m/ref" } }] });
  });

  it("builds Video API bodies with the scene frame as the exact first frame", () => {
    const clip = { prompt: "slow push in", durationSec: 7, image: {}, seed: 3 };
    expect(findVideoModel("or:heygen-video")!.buildInput(clip, "https://api.example/m/f")).toEqual({
      model: "heygen/heygen-video-1",
      prompt: "slow push in",
      duration: 5,
      aspect_ratio: "9:16",
      resolution: "768p",
      seed: 3,
      frame_images: [{ type: "image_url", image_url: { url: "https://api.example/m/f" }, frame_type: "first_frame" }],
    });
    expect(findVideoModel("or:veo-3.1-lite")!.buildInput(clip, "u")).toMatchObject({ duration: 6, resolution: "720p", generate_audio: false });
  });
});

describe("OpenRouterImageProvider", () => {
  it("posts to /images and decodes the base64 result with the reported cost", async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ b64_json: Buffer.from("jpeg-bytes").toString("base64"), media_type: "image/jpeg" }], usage: { cost: 0.021 } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new OpenRouterImageProvider(conn, findImageModel("or:seedream-5.5")!);
    const out = await p.generate({ prompt: "p", width: 864, height: 1536 }, {});
    expect(out.bytes?.toString()).toBe("jpeg-bytes");
    expect(out.costUsd).toBe(0.021);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-or-test");
    expect(JSON.parse(String(init.body)).model).toBe("bytedance-seed/seedream-5-5");
  });
});

describe("OpenRouterVideoProvider", () => {
  const provider = () => new OpenRouterVideoProvider(conn, findVideoModel("or:heygen-video")!);
  const ext = JSON.stringify({ id: "gen-vid-1", poll: "https://openrouter.ai/api/v1/videos/gen-vid-1" });

  it("submits with a public frame URL and resolves the relative polling URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "gen-vid-1", polling_url: "/api/v1/videos/gen-vid-1", status: "pending" })));
    const { externalId } = await provider().submit({ prompt: "p", durationSec: 5, image: { url: "https://api.example/m/f" } }, {});
    expect(JSON.parse(externalId)).toEqual({ id: "gen-vid-1", poll: "https://openrouter.ai/api/v1/videos/gen-vid-1" });
  });

  it("refuses a frame that is only a data URI (providers download frames themselves)", async () => {
    await expect(provider().submit({ prompt: "p", durationSec: 5, image: { dataUri: "data:image/jpeg;base64,AA" } }, {})).rejects.toThrow(/public URL/);
  });

  it("maps job states", async () => {
    for (const [status, state] of [["pending", "queued"], ["in_progress", "running"], ["cancelled", "cancelled"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ id: "gen-vid-1", status })));
      expect((await provider().getStatus(ext, {})).state).toBe(state);
    }
  });

  it("downloads OpenRouter content URLs with the key, signed third-party URLs without it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "completed", unsigned_urls: ["/api/v1/videos/gen-vid-1/content?index=0"] })));
    const own = await provider().getStatus(ext, {});
    expect(own).toMatchObject({ state: "succeeded", videoUrl: "https://openrouter.ai/api/v1/videos/gen-vid-1/content?index=0", videoHeaders: { authorization: "Bearer sk-or-test" } });

    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "completed", urls: ["https://storage.example/v.mp4?sig=1"], unsigned_urls: ["/api/v1/videos/gen-vid-1/content?index=0"] })));
    const signed = await provider().getStatus(ext, {});
    expect(signed.videoUrl).toBe("https://storage.example/v.mp4?sig=1");
    expect(signed.videoHeaders).toBeUndefined();
  });

  it("treats a moderation failure as rejected content, other failures as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "failed", error: "Input image flagged by content moderation" })));
    expect(await provider().getStatus(ext, {})).toMatchObject({ state: "failed", retryable: false, rejectedContent: true });
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "failed", error: "upstream timeout" })));
    expect(await provider().getStatus(ext, {})).toMatchObject({ state: "failed", retryable: true, rejectedContent: false });
  });
});
