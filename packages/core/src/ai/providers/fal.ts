import { ProviderError } from "../../errors";
import { fetchJson } from "../http";
import type { AiCallContext, ImageModelSpec, ImageProvider, ImageRequest, ImageResult, VideoModelSpec, VideoProvider, VideoRequest, VideoTaskStatus } from "../types";

/**
 * fal.ai adapters.
 *  - Images: synchronous endpoint  POST https://fal.run/{model}
 *  - Video:  queue API             POST https://queue.fal.run/{model}
 *            → { request_id, status_url, response_url, cancel_url }
 *            GET status_url → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *            GET response_url → model output
 * Auth header: `Authorization: Key <FAL_KEY>`.
 */

const auth = (key: string) => ({ authorization: `Key ${key}` });

interface FalImageOutput {
  images?: { url: string; content_type?: string; width?: number; height?: number }[];
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

export class FalImageProvider implements ImageProvider {
  readonly isDemo = false;
  constructor(
    private readonly key: string,
    readonly spec: ImageModelSpec,
  ) {}

  async generate(req: ImageRequest, ctx: AiCallContext): Promise<ImageResult> {
    if (this.spec.requiresReferenceImage && !req.referenceImage) {
      throw new ProviderError("fal", `${this.spec.model} requires a reference image`, { retryable: false, code: "generation_failed" });
    }
    const out = await fetchJson<FalImageOutput>("fal", `https://fal.run/${this.spec.model}`, {
      body: this.spec.buildInput(req),
      headers: auth(this.key),
      timeoutMs: 240_000,
      signal: ctx.signal,
    });
    if (out.has_nsfw_concepts?.[0]) {
      throw new ProviderError("fal", "output blocked by safety checker", { retryable: false, code: "provider_rejected_content" });
    }
    const img = out.images?.[0];
    if (!img?.url) throw new ProviderError("fal", "no image in response", { retryable: true });
    return { url: img.url, contentType: img.content_type, seed: out.seed, costUsd: this.spec.costPerImageUsd };
  }
}

interface FalQueueSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

interface FalExternalRef {
  id: string;
  status: string;
  response: string;
  cancel?: string;
}

export class FalVideoProvider implements VideoProvider {
  readonly isDemo = false;
  constructor(
    private readonly key: string,
    readonly spec: VideoModelSpec,
  ) {}

  async submit(req: VideoRequest, ctx: AiCallContext): Promise<{ externalId: string }> {
    const image = req.image.url ?? req.image.dataUri;
    if (!image) throw new ProviderError("fal", "start frame missing", { retryable: false });
    const res = await fetchJson<FalQueueSubmit>("fal", `https://queue.fal.run/${this.spec.model}`, {
      body: this.spec.buildInput(req, image),
      headers: auth(this.key),
      timeoutMs: 120_000,
      signal: ctx.signal,
    });
    if (!res?.request_id || !res.status_url || !res.response_url) throw new ProviderError("fal", "unexpected queue response", { retryable: true });
    const ref: FalExternalRef = { id: res.request_id, status: res.status_url, response: res.response_url, cancel: res.cancel_url };
    return { externalId: JSON.stringify(ref) };
  }

  async getStatus(externalId: string, ctx: AiCallContext): Promise<VideoTaskStatus> {
    const ref = JSON.parse(externalId) as FalExternalRef;
    const st = await fetchJson<{ status?: string; error?: string }>("fal", ref.status, { headers: auth(this.key), timeoutMs: 60_000, signal: ctx.signal });
    if (st.status === "IN_QUEUE") return { state: "queued" };
    if (st.status === "IN_PROGRESS") return { state: "running" };
    if (st.status !== "COMPLETED") return { state: "running" };
    try {
      const out = await fetchJson<{ video?: { url?: string } }>("fal", ref.response, { headers: auth(this.key), timeoutMs: 60_000, signal: ctx.signal });
      if (!out.video?.url) return { state: "failed", error: "no video in response", retryable: true };
      return { state: "succeeded", videoUrl: out.video.url };
    } catch (err) {
      const e = err as ProviderError;
      return { state: "failed", error: e.message, retryable: e.retryable, rejectedContent: e.code === "provider_rejected_content" };
    }
  }

  async cancel(externalId: string): Promise<void> {
    const ref = JSON.parse(externalId) as FalExternalRef;
    if (!ref.cancel) return;
    await fetchJson("fal", ref.cancel, { method: "PUT", headers: auth(this.key), timeoutMs: 30_000 }).catch(() => undefined);
  }
}
