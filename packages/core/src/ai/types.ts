import type { ZodType } from "zod";

export interface AiCallContext {
  userId?: string | null;
  jobId?: string | null;
  dreamId?: string | null;
  signal?: AbortSignal;
}

// ─── Speech-to-text ─────────────────────────────────────────────────────────

export interface SttInput {
  filePath: string;
  fileName: string;
  mime: string;
  durationSec?: number;
  /** Force a language; undefined = auto-detect. */
  language?: "ru" | "en";
}

export interface SttResult {
  text: string;
  language?: string;
  durationSec?: number;
  costUsd: number;
}

export interface SttProvider {
  readonly id: string;
  readonly model: string;
  readonly isDemo: boolean;
  transcribe(input: SttInput, ctx: AiCallContext): Promise<SttResult>;
}

// ─── LLM ────────────────────────────────────────────────────────────────────

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly isDemo: boolean;
  generateStructured<T>(req: StructuredRequest<T>, ctx: AiCallContext): Promise<StructuredResult<T>>;
}

// ─── Images ─────────────────────────────────────────────────────────────────

/** An input image for a provider: a public URL when available, otherwise a data URI. */
export interface ImageInput {
  url?: string;
  dataUri?: string;
  filePath?: string;
  mime?: string;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width: number;
  height: number;
  /** Only passed when the model spec declares `supportsReferenceImage`. */
  referenceImage?: ImageInput;
  /** Short human label (demo provider prints it on the frame). */
  label?: string;
}

export interface ImageResult {
  url?: string;
  bytes?: Buffer;
  contentType?: string;
  seed?: number;
  costUsd: number;
}

export interface ImageModelSpec {
  /** Catalog id, e.g. "fal:flux-dev". */
  id: string;
  provider: "fal" | "replicate" | "openai" | "demo";
  /** Provider-side model identifier. */
  model: string;
  label: string;
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  /** Accepts an input image that conditions the result (identity/scene consistency). */
  supportsReferenceImage: boolean;
  /** Requires an input image (editing models such as FLUX Kontext). */
  requiresReferenceImage?: boolean;
  costPerImageUsd: number;
  buildInput(req: ImageRequest): Record<string, unknown>;
}

export interface ImageProvider {
  readonly spec: ImageModelSpec;
  readonly isDemo: boolean;
  generate(req: ImageRequest, ctx: AiCallContext): Promise<ImageResult>;
}

// ─── Video ──────────────────────────────────────────────────────────────────

export interface VideoRequest {
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  image: ImageInput;
  seed?: number;
  label?: string;
}

export type VideoTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface VideoTaskStatus {
  state: VideoTaskState;
  videoUrl?: string;
  error?: string;
  retryable?: boolean;
  rejectedContent?: boolean;
}

export interface VideoModelSpec {
  id: string;
  provider: "fal" | "replicate" | "runway" | "demo";
  model: string;
  label: string;
  /** Clip durations (seconds) the API actually accepts. */
  clipDurations: number[];
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  /** Needs a start frame (image-to-video). */
  imageToVideo: true;
  supportsCancel: boolean;
  costPerSecondUsd: number;
  buildInput(req: VideoRequest, imageRef: string): Record<string, unknown>;
}

export interface VideoProvider {
  readonly spec: VideoModelSpec;
  readonly isDemo: boolean;
  submit(req: VideoRequest, ctx: AiCallContext): Promise<{ externalId: string }>;
  getStatus(externalId: string, ctx: AiCallContext): Promise<VideoTaskStatus>;
  cancel?(externalId: string): Promise<void>;
}
