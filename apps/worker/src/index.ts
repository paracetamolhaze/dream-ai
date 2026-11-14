import http from "node:http";
import { Worker, type Job, type WorkerOptions } from "bullmq";
import { closeDb, getPool } from "@dream/core/db/client";
import { env } from "@dream/core/env";
import { logger } from "@dream/core/logger";
import { processAnalysis } from "@dream/core/pipeline/analyze";
import { classifyError, type AttemptInfo } from "@dream/core/pipeline/common";
import { failGenerationJob, processGeneration } from "@dream/core/pipeline/generate";
import { processPreview } from "@dream/core/pipeline/preview";
import { processSystem, reconcileGenerationJobs } from "@dream/core/pipeline/system";
import { processTranscription } from "@dream/core/pipeline/transcribe";
import { closeQueues, getQueue, QUEUES, type GenerationPayload, type QueueName } from "@dream/core/queue";
import { closeRedis, createBullConnection, getRedis } from "@dream/core/redis";
import { getSettings, type Settings } from "@dream/core/settings";

/**
 * DREAM AI generation worker. One BullMQ worker per queue; heavy work (AI
 * calls, FFmpeg) never runs inside HTTP requests. Jobs persist in Redis (AOF)
 * and every pipeline step is idempotent, so a restart resumes where it stopped.
 */

const log = logger.child({ svc: "worker" });
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8082);

function attemptOf(job: Job): AttemptInfo {
  return { attemptsMade: job.attemptsMade, attempts: job.opts.attempts ?? 1, owner: job.id ?? `${job.name}-${job.timestamp}` };
}

type ConcurrencyKey = keyof Settings["concurrency"];

interface WorkerSpec {
  queue: QueueName;
  concurrency: (s: Settings) => number;
  processor: (job: Job) => Promise<unknown>;
  /**
   * BullMQ lock (auto-renewed while a job runs). Heavy work runs in FFmpeg child
   * processes, so 60 s is ample — and a crashed worker's jobs are picked up again
   * within ~1.5 min.
   */
  lockDuration?: number;
}

const fromSetting = (key: ConcurrencyKey) => (s: Settings) => s.concurrency[key];

const SPECS: WorkerSpec[] = [
  { queue: QUEUES.transcription, concurrency: fromSetting("transcription"), processor: (job) => processTranscription(job.data, attemptOf(job)) },
  { queue: QUEUES.analysis, concurrency: fromSetting("analysis"), processor: (job) => processAnalysis(job.data, attemptOf(job)) },
  { queue: QUEUES.preview, concurrency: fromSetting("slideshow"), processor: (job) => processPreview(job.data, attemptOf(job)) },
  { queue: QUEUES.slideshow, concurrency: fromSetting("slideshow"), processor: (job) => processGeneration((job.data as GenerationPayload).jobId, attemptOf(job)) },
  { queue: QUEUES.video, concurrency: fromSetting("video"), processor: (job) => processGeneration((job.data as GenerationPayload).jobId, attemptOf(job)) },
  { queue: QUEUES.system, concurrency: () => 2, processor: (job) => processSystem(job.data, attemptOf(job)) },
];

async function main(): Promise<void> {
  env(); // fail fast on invalid configuration
  const settings = await getSettings({ fresh: true });

  const workers = SPECS.map((spec) => {
    const opts: WorkerOptions = {
      connection: createBullConnection(),
      concurrency: Math.max(1, spec.concurrency(settings)),
      lockDuration: spec.lockDuration ?? 60_000,
      // A job may survive a few worker restarts (deploys) before BullMQ gives up on it.
      maxStalledCount: 3,
    };
    const worker = new Worker(spec.queue, spec.processor, opts);
    worker.on("failed", (job, err) => {
      if (!job) return;
      const final = err.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts ?? 1);
      log.warn("job attempt failed", { queue: spec.queue, jobId: job.id, attemptsMade: job.attemptsMade, final, error: err.message });
      // Safety net: if BullMQ gave up (e.g. stalled too often) without the pipeline finalizing the job,
      // fail it here so credits are returned. No-op when the job is already terminal.
      if (final && (spec.queue === QUEUES.slideshow || spec.queue === QUEUES.video)) {
        const c = classifyError(err);
        void failGenerationJob((job.data as GenerationPayload).jobId, { code: c.code, message: c.message }).catch((e: Error) => log.error("finalize failed job", { error: e.message }));
      }
    });
    worker.on("error", (err) => log.error("worker error", { queue: spec.queue, error: err.message }));
    return { spec, worker };
  });
  log.info("workers started", { queues: workers.map((w) => `${w.spec.queue}×${w.worker.concurrency}`) });

  // Admin can change concurrency limits at runtime.
  const refresh = setInterval(() => {
    void getSettings({ fresh: true })
      .then((s) => {
        for (const { spec, worker } of workers) {
          const next = Math.max(1, spec.concurrency(s));
          if (worker.concurrency !== next) {
            worker.concurrency = next;
            log.info("concurrency updated", { queue: spec.queue, concurrency: next });
          }
        }
      })
      .catch((err: Error) => log.warn("settings refresh failed", { error: err.message }));
  }, 60_000);

  // Recurring system jobs (idempotent upserts — safe with several replicas).
  const system = getQueue(QUEUES.system);
  await system.upsertJobScheduler("maintenance", { every: 5 * 60_000 }, { name: "maintenance", data: { type: "maintenance" }, opts: { attempts: 1 } });
  await system.upsertJobScheduler("reminders", { every: 5 * 60_000 }, { name: "reminders", data: { type: "reminders" }, opts: { attempts: 1 } });
  await system.add("seed_music", { type: "seed_music" }, { jobId: `seed-music-${new Date().toISOString().slice(0, 10)}`, attempts: 3 });

  // Nothing may silently disappear after a restart: every active DB job must have a BullMQ job.
  try {
    const r = await reconcileGenerationJobs({ staleMinutes: 0, startup: true });
    if (r.requeued || r.failed) log.warn("startup reconciliation", r);
  } catch (err) {
    log.error("startup reconciliation failed", { error: (err as Error).message });
  }

  const server = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
    Promise.race([Promise.all([getRedis().ping(), getPool().query("select 1")]), timeout])
      .then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, workers: workers.map((w) => ({ queue: w.spec.queue, running: w.worker.isRunning(), concurrency: w.worker.concurrency })) }));
      })
      .catch((err: Error) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
  });
  server.listen(HEALTH_PORT, () => log.info("health endpoint listening", { port: HEALTH_PORT }));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down — waiting for active jobs", { signal });
    clearInterval(refresh);
    server.close();
    // close() waits for running jobs; whatever is still running when the container is killed
    // becomes "stalled" and is resumed by the next worker (checkpoints + stored provider task ids).
    await Promise.race([Promise.all(workers.map((w) => w.worker.close())), new Promise((r) => setTimeout(r, 50_000))]);
    await closeQueues();
    await closeRedis();
    await closeDb();
    log.info("worker stopped");
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker failed to start", { error: err });
  process.exit(1);
});
