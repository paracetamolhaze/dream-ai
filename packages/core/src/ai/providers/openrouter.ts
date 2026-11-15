import { ProviderError } from "../../errors";
import { fetchJson } from "../http";
import type { AiCallContext, ImageModelSpec, ImageProvider, ImageRequest, ImageResult, VideoModelSpec, VideoProvider, VideoRequest, VideoTaskStatus } from "../types";

/**
 * OpenRouter adapters — one key for every generation step.
 *  - Images: POST {base}/images            → { data: [{ b64_json, media_type }], usage: { cost } }
 *  - Video:  POST {base}/videos            → { id, polling_url, status }
 *            GET  polling_url              → { status: pending | in_progress | completed | failed | cancelled | expired,
 *                                              urls (signed), unsigned_urls (need the API key), usage: { cost } }
 * Speech-to-text and the LLM use OpenRouter's OpenAI-compatible endpoints
 * (see openai-compatible.ts). The request bodies (model id included) come
 * from each catalog entry's `buildInput`.
 */

export interface OpenRouterConn {
  baseUrl: string;
  apiKey: string;
}

const auth = (c: OpenRouterConn) => ({ authorization: `Bearer ${c.apiKey}` });

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; media_type?: string }[];
  usage?: { cost?: number };
}

export class OpenRouterImageProvider implements ImageProvider {
  readonly isDemo = false;
  constructor(
    private readonly conn: OpenRouterConn,
    readonly spec: ImageModelSpec,
  ) {}

  async generate(req: ImageRequest, ctx: AiCallContext): Promise<ImageResult> {
    if (this.spec.requiresReferenceImage && !req.referenceImage) {
      throw new ProviderError("openrouter", `${this.spec.model} requires a reference image`, { retryable: false, code: "generation_failed" });
    }
    const out = await fetchJson<ImagesResponse>("openrouter", `${this.conn.baseUrl.replace(/\/$/, "")}/images`, {
      body: this.spec.buildInput(req),
      headers: auth(this.conn),
      timeoutMs: 240_000,
      signal: ctx.signal,
    });
    const img = out?.data?.[0];
    const costUsd = typeof out?.usage?.cost === "number" ? out.usage.cost : this.spec.costPerImageUsd;
    if (img?.b64_json) return { bytes: Buffer.from(img.b64_json, "base64"), contentType: img.media_type, seed: req.seed, costUsd };
    if (img?.url) return { url: img.url, contentType: img.media_type, seed: req.seed, costUsd };
    throw new ProviderError("openrouter", "no image in response", { retryable: true });
  }
}

interface VideoJob {
  id?: string;
  polling_url?: string;
  status?: string;
  error?: string;
  urls?: string[];
  unsigned_urls?: string[];
}

interface VideoRef {
  id: string;
  poll: string;
}

/** Errors that mean the prompt/frame itself was declined — retrying the same input will not help. */
const REJECTED = /moderat|content polic|safety|nsfw|prohibited|not allowed|violat/i;

export class OpenRouterVideoProvider implements VideoProvider {
  readonly isDemo = false;
  constructor(
    private readonly conn: OpenRouterConn,
    readonly spec: VideoModelSpec,
  ) {}

  private get base(): string {
    return this.conn.baseUrl.replace(/\/$/, "");
  }

  /** OpenRouter returns `polling_url` relative to its origin. */
  private absolute(u: string): string {
    return new URL(u, new URL(this.base).origin).toString();
  }

  /** The API key is only ever sent to OpenRouter itself, never to a third-party download host. */
  private headersFor(u: string): Record<string, string> | undefined {
    return new URL(u).origin === new URL(this.base).origin ? auth(this.conn) : undefined;
  }

  async submit(req: VideoRequest, ctx: AiCallContext): Promise<{ externalId: string }> {
    // Providers download the start frame themselves: it must be a public HTTPS URL.
    const image = req.image.url;
    if (!image) throw new ProviderError("openrouter", "start frame needs a public URL (set PUBLIC_API_URL to an https origin)", { retryable: false });
    const job = await fetchJson<VideoJob>("openrouter", `${this.base}/videos`, {
      body: this.spec.buildInput(req, image),
      headers: auth(this.conn),
      timeoutMs: 120_000,
      signal: ctx.signal,
    });
    if (!job?.id) throw new ProviderError("openrouter", "unexpected video response", { retryable: true });
    const ref: VideoRef = { id: job.id, poll: this.absolute(job.polling_url ?? `/api/v1/videos/${job.id}`) };
    return { externalId: JSON.stringify(ref) };
  }

  async getStatus(externalId: string, ctx: AiCallContext): Promise<VideoTaskStatus> {
    const ref = JSON.parse(externalId) as VideoRef;
    const job = await fetchJson<VideoJob>("openrouter", ref.poll, { headers: auth(this.conn), timeoutMs: 60_000, signal: ctx.signal });
    switch (job?.status) {
      case "pending":
        return { state: "queued" };
      case "in_progress":
        return { state: "running" };
      case "completed": {
        const url = job.urls?.[0] ?? (job.unsigned_urls?.[0] ? this.absolute(job.unsigned_urls[0]) : `${this.base}/videos/${ref.id}/content?index=0`);
        return { state: "succeeded", videoUrl: url, videoHeaders: this.headersFor(url) };
      }
      case "cancelled":
        return { state: "cancelled" };
      case "failed":
      case "expired": {
        const error = job.error ?? `video job ${job.status}`;
        return { state: "failed", error, retryable: !REJECTED.test(error), rejectedContent: REJECTED.test(error) };
      }
      default:
        return { state: "running" };
    }
  }
}
