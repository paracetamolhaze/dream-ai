import { ProviderError } from "../../errors";
import { fetchJson } from "../http";
import type { AiCallContext, VideoModelSpec, VideoProvider, VideoRequest, VideoTaskStatus } from "../types";

/**
 * Runway API (https://docs.dev.runwayml.com):
 *   POST   /v1/image_to_video  { model, promptImage, promptText, ratio, duration, seed } → { id }
 *   GET    /v1/tasks/{id}      → { status: PENDING|THROTTLED|RUNNING|SUCCEEDED|FAILED|CANCELLED, output?: string[], failure?, failureCode? }
 *   DELETE /v1/tasks/{id}      cancels / deletes a task
 * Header X-Runway-Version is required.
 */

const API = "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";

export class RunwayVideoProvider implements VideoProvider {
  readonly isDemo = false;
  constructor(
    private readonly key: string,
    readonly spec: VideoModelSpec,
  ) {}

  private headers() {
    return { authorization: `Bearer ${this.key}`, "x-runway-version": VERSION };
  }

  async submit(req: VideoRequest, ctx: AiCallContext): Promise<{ externalId: string }> {
    const image = req.image.url ?? req.image.dataUri;
    if (!image) throw new ProviderError("runway", "start frame missing", { retryable: false });
    const res = await fetchJson<{ id?: string }>("runway", `${API}/image_to_video`, {
      body: this.spec.buildInput(req, image),
      headers: this.headers(),
      timeoutMs: 120_000,
      signal: ctx.signal,
    });
    if (!res.id) throw new ProviderError("runway", "no task id returned", { retryable: true });
    return { externalId: res.id };
  }

  async getStatus(externalId: string, ctx: AiCallContext): Promise<VideoTaskStatus> {
    const t = await fetchJson<{ status?: string; output?: string[]; failure?: string; failureCode?: string }>("runway", `${API}/tasks/${externalId}`, {
      headers: this.headers(),
      timeoutMs: 30_000,
      signal: ctx.signal,
    });
    switch (t.status) {
      case "PENDING":
      case "THROTTLED":
        return { state: "queued" };
      case "RUNNING":
        return { state: "running" };
      case "SUCCEEDED":
        return t.output?.[0] ? { state: "succeeded", videoUrl: t.output[0] } : { state: "failed", error: "no output", retryable: true };
      case "CANCELLED":
        return { state: "cancelled" };
      case "FAILED": {
        const moderation = /SAFETY|MODERATION|CONTENT/i.test(t.failureCode ?? "") || /moderation|safety/i.test(t.failure ?? "");
        return { state: "failed", error: t.failure ?? t.failureCode ?? "failed", retryable: !moderation && /INTERNAL/i.test(t.failureCode ?? "INTERNAL"), rejectedContent: moderation };
      }
      default:
        return { state: "running" };
    }
  }

  async cancel(externalId: string): Promise<void> {
    await fetchJson("runway", `${API}/tasks/${externalId}`, { method: "DELETE", headers: this.headers(), timeoutMs: 30_000 }).catch(() => undefined);
  }
}
