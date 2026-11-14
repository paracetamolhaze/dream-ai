import { ProviderError } from "../../errors";
import { sleep } from "../../utils";
import { fetchJson } from "../http";
import type { AiCallContext, ImageModelSpec, ImageProvider, ImageRequest, ImageResult, VideoModelSpec, VideoProvider, VideoRequest, VideoTaskStatus } from "../types";

/**
 * Replicate HTTP API:
 *   POST /v1/models/{owner}/{name}/predictions  { input }   (Prefer: wait → sync up to 60s)
 *   GET  /v1/predictions/{id}
 *   POST /v1/predictions/{id}/cancel
 * Prediction status: starting | processing | succeeded | failed | canceled
 */

const API = "https://api.replicate.com/v1";

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
}

function firstUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.find((o): o is string => typeof o === "string");
  if (output && typeof output === "object" && "url" in output && typeof (output as { url: unknown }).url === "string") return (output as { url: string }).url;
  return undefined;
}

function isSafetyError(msg?: string | null): boolean {
  return Boolean(msg && /(nsfw|safety|sensitive|flagged|content)/i.test(msg));
}

export class ReplicateImageProvider implements ImageProvider {
  readonly isDemo = false;
  constructor(
    private readonly token: string,
    readonly spec: ImageModelSpec,
  ) {}

  async generate(req: ImageRequest, ctx: AiCallContext): Promise<ImageResult> {
    if (this.spec.requiresReferenceImage && !req.referenceImage) {
      throw new ProviderError("replicate", `${this.spec.model} requires a reference image`, { retryable: false });
    }
    const headers = { authorization: `Bearer ${this.token}`, prefer: "wait=60" };
    let p = await fetchJson<Prediction>("replicate", `${API}/models/${this.spec.model}/predictions`, {
      body: { input: this.spec.buildInput(req) },
      headers,
      timeoutMs: 90_000,
      signal: ctx.signal,
    });
    const deadline = Date.now() + 4 * 60_000;
    while ((p.status === "starting" || p.status === "processing") && Date.now() < deadline) {
      await sleep(2000);
      p = await fetchJson<Prediction>("replicate", `${API}/predictions/${p.id}`, { headers: { authorization: `Bearer ${this.token}` }, timeoutMs: 30_000, signal: ctx.signal });
    }
    if (p.status === "succeeded") {
      const url = firstUrl(p.output);
      if (url) return { url, seed: req.seed, costUsd: this.spec.costPerImageUsd };
      throw new ProviderError("replicate", "no image in output", { retryable: true });
    }
    if (p.status === "failed" || p.status === "canceled") {
      throw new ProviderError("replicate", p.error ?? p.status, { retryable: !isSafetyError(p.error), code: isSafetyError(p.error) ? "provider_rejected_content" : "generation_failed" });
    }
    throw new ProviderError("replicate", "image generation timed out", { retryable: true, code: "provider_timeout" });
  }
}

export class ReplicateVideoProvider implements VideoProvider {
  readonly isDemo = false;
  constructor(
    private readonly token: string,
    readonly spec: VideoModelSpec,
  ) {}

  async submit(req: VideoRequest, ctx: AiCallContext): Promise<{ externalId: string }> {
    const image = req.image.url ?? req.image.dataUri;
    if (!image) throw new ProviderError("replicate", "start frame missing", { retryable: false });
    const p = await fetchJson<Prediction>("replicate", `${API}/models/${this.spec.model}/predictions`, {
      body: { input: this.spec.buildInput(req, image) },
      headers: { authorization: `Bearer ${this.token}` },
      timeoutMs: 120_000,
      signal: ctx.signal,
    });
    return { externalId: p.id };
  }

  async getStatus(externalId: string, ctx: AiCallContext): Promise<VideoTaskStatus> {
    const p = await fetchJson<Prediction>("replicate", `${API}/predictions/${externalId}`, { headers: { authorization: `Bearer ${this.token}` }, timeoutMs: 30_000, signal: ctx.signal });
    switch (p.status) {
      case "starting":
        return { state: "queued" };
      case "processing":
        return { state: "running" };
      case "succeeded": {
        const url = firstUrl(p.output);
        return url ? { state: "succeeded", videoUrl: url } : { state: "failed", error: "no video in output", retryable: true };
      }
      case "canceled":
        return { state: "cancelled" };
      default:
        return { state: "failed", error: p.error ?? "failed", retryable: !isSafetyError(p.error), rejectedContent: isSafetyError(p.error) };
    }
  }

  async cancel(externalId: string): Promise<void> {
    await fetchJson("replicate", `${API}/predictions/${externalId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, timeoutMs: 30_000 }).catch(() => undefined);
  }
}
