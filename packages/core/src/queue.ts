import { Queue, type JobsOptions } from "bullmq";
import { createBullConnection } from "./redis";

export const QUEUES = {
  transcription: "transcription",
  analysis: "analysis",
  preview: "preview",
  slideshow: "generate-slideshow",
  video: "generate-video",
  system: "system",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface TranscriptionPayload {
  dreamId: string;
  /** Telegram chat to reply in (dreams sent directly to the bot). */
  replyChatId?: number;
  attempt: number;
}
export interface AnalysisPayload {
  dreamId: string;
  replyChatId?: number;
}
export interface PreviewPayload {
  dreamId: string;
}
export interface GenerationPayload {
  jobId: string;
}
export type SystemPayload =
  | { type: "delete_account"; userId: string; telegramId: number }
  | { type: "purge_dream"; dreamId: string; userId: string }
  | { type: "maintenance" }
  | { type: "publish_channel_post"; postId: string }
  | { type: "reminders" }
  | { type: "seed_music" };

export interface QueuePayloads {
  [QUEUES.transcription]: TranscriptionPayload;
  [QUEUES.analysis]: AnalysisPayload;
  [QUEUES.preview]: PreviewPayload;
  [QUEUES.slideshow]: GenerationPayload;
  [QUEUES.video]: GenerationPayload;
  [QUEUES.system]: SystemPayload;
}

declare global {
  // eslint-disable-next-line no-var
  var __dreamQueues: Map<string, Queue> | undefined;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function getQueue<N extends QueueName>(name: N): Queue<QueuePayloads[N]> {
  if (!globalThis.__dreamQueues) globalThis.__dreamQueues = new Map();
  let q = globalThis.__dreamQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: createBullConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    globalThis.__dreamQueues.set(name, q);
  }
  return q as unknown as Queue<QueuePayloads[N]>;
}

/** BullMQ custom ids must not contain ':' — we use '-' separated ids. */
export function jobIdFor(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/:/g, "-")).join("-");
}

export async function enqueue<N extends QueueName>(name: N, payload: QueuePayloads[N], opts: JobsOptions & { jobId: string }): Promise<void> {
  const q = getQueue(name) as unknown as Queue;
  await q.add(name, payload, opts);
}

export async function closeQueues(): Promise<void> {
  if (!globalThis.__dreamQueues) return;
  await Promise.all([...globalThis.__dreamQueues.values()].map((q) => q.close().catch(() => undefined)));
  globalThis.__dreamQueues.clear();
}
