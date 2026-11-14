import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { UnrecoverableError } from "bullmq";
import { workDir } from "../ai/providers/demo";
import { AppError, ProviderError, type ErrorCode } from "../errors";
import { FfmpegError } from "../media/ffmpeg";
import { getRedis } from "../redis";
import { sleep } from "../utils";

/** BullMQ attempt bookkeeping passed from the worker into pipeline steps. */
export interface AttemptInfo {
  /** Attempts already made before the current one (BullMQ `job.attemptsMade`). */
  attemptsMade: number;
  /** Configured attempts (`job.opts.attempts`). */
  attempts: number;
  /** Stable owner id for locks (the BullMQ job id) — re-entrant across retries of one job. */
  owner: string;
}

export function isFinalAttempt(a: Pick<AttemptInfo, "attemptsMade" | "attempts">): boolean {
  return a.attemptsMade + 1 >= Math.max(1, a.attempts);
}

/** The job was cancelled (by the user, dream/account deletion) — stop quietly. */
export class JobCancelledError extends Error {
  constructor(message = "job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export interface ClassifiedError {
  retryable: boolean;
  code: ErrorCode;
  message: string;
}

/** Maps any thrown value to a stable error code + retry decision. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ProviderError) return { retryable: err.retryable, code: err.code, message: err.message };
  if (err instanceof AppError) return { retryable: err.retryable, code: err.code, message: err.message };
  if (err instanceof FfmpegError) return { retryable: true, code: "generation_failed", message: `${err.message}: ${err.stderrTail.slice(-600)}` };
  if (err instanceof UnrecoverableError) return { retryable: false, code: "internal", message: err.message };
  const e = err as Error | undefined;
  return { retryable: true, code: "internal", message: e?.message ?? String(err) };
}

// ─── Temp work directories ──────────────────────────────────────────────────

export function jobsRoot(): string {
  return path.join(workDir(), "jobs");
}

export async function createJobDir(prefix: string): Promise<string> {
  const dir = path.join(jobsRoot(), `${prefix}-${randomBytes(4).toString("hex")}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Removes leftovers of crashed runs (job dirs, demo provider dirs) older than `maxAgeMs`. */
export async function cleanupOldWorkDirs(maxAgeMs = 6 * 3600_000): Promise<number> {
  let removed = 0;
  for (const root of [jobsRoot(), path.join(workDir(), "demo")]) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = path.join(root, name);
      try {
        const s = await stat(p);
        if (Date.now() - s.mtimeMs > maxAgeMs) {
          await rm(p, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* already gone */
      }
    }
  }
  return removed;
}

// ─── Abort helpers ──────────────────────────────────────────────────────────

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new JobCancelledError(String(signal.reason ?? "aborted"));
}

/** sleep() that wakes up early (and throws) when the signal aborts. */
export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new JobCancelledError(String(signal.reason ?? "aborted")));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new JobCancelledError(String(signal.reason ?? "aborted")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs tasks with a concurrency cap. On the first failure no new tasks are
 * started, in-flight tasks get an abort signal (reason "batch"), and the first
 * error is rethrown once everything has settled — so no task keeps writing to
 * the database after the job has been marked failed.
 */
export async function runPool<T, R>(items: readonly T[], limit: number, parent: AbortSignal, fn: (item: T, index: number, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const batch = new AbortController();
  const signal = AbortSignal.any([parent, batch.signal]);
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && !signal.aborted) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i, signal);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
          batch.abort("batch");
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw firstError;
  throwIfAborted(parent);
  return results;
}

// ─── Distributed "produce once" ─────────────────────────────────────────────

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Acquires a Redis lock. Re-entrant for the same owner (a retried job takes its own lock back). */
export async function tryLock(key: string, owner: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  const ok = await redis.set(key, owner, "PX", ttlMs, "NX");
  if (ok === "OK") return true;
  const holder = await redis.get(key);
  if (holder === owner) {
    await redis.pexpire(key, ttlMs);
    return true;
  }
  return false;
}

export async function releaseLock(key: string, owner: string): Promise<void> {
  await getRedis()
    .eval(RELEASE_SCRIPT, 1, key, owner)
    .catch(() => undefined);
}

/**
 * Returns a cached asset, waits while another job produces the same asset, or
 * produces it under a lock. Prevents paying twice when two jobs (e.g. the
 * slideshow and the video of one dream) need the same frame at the same time.
 */
export async function produceOnce<T>(opts: {
  key: string;
  owner: string;
  ttlMs: number;
  waitMs: number;
  signal?: AbortSignal;
  lookup: () => Promise<T | null | undefined>;
  produce: () => Promise<T>;
}): Promise<T> {
  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    throwIfAborted(opts.signal);
    const cached = await opts.lookup();
    if (cached) return cached;
    if (await tryLock(opts.key, opts.owner, opts.ttlMs)) {
      try {
        const again = await opts.lookup();
        if (again) return again;
        return await opts.produce();
      } finally {
        await releaseLock(opts.key, opts.owner);
      }
    }
    if (Date.now() > deadline) {
      throw new ProviderError("asset-lock", "timed out waiting for a concurrent generation of the same asset", { retryable: true });
    }
    await sleepWithSignal(2000, opts.signal);
  }
}
