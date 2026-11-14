import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { aiUsage, generationJobs } from "../db/schema";
import { AppError } from "../errors";
import { getSettings } from "../settings";
import { startOfUtcDay } from "../utils";

export interface UsageRecord {
  kind: "stt" | "llm" | "image" | "video";
  provider: string;
  model: string;
  costUsd: number;
  units?: number;
  unit?: string;
  durationMs?: number;
  success?: boolean;
  isDemo?: boolean;
  error?: string;
  userId?: string | null;
  jobId?: string | null;
  dreamId?: string | null;
}

/** Logs every paid AI call; also accumulates the job's actual cost. */
export async function recordUsage(r: UsageRecord): Promise<void> {
  const db = getDb();
  await db.insert(aiUsage).values({
    kind: r.kind,
    provider: r.provider,
    model: r.model,
    costUsd: Number(r.costUsd.toFixed(4)),
    units: r.units ?? 1,
    unit: r.unit ?? "request",
    durationMs: r.durationMs,
    success: r.success ?? true,
    isDemo: r.isDemo ?? false,
    error: r.error?.slice(0, 500),
    userId: r.userId ?? null,
    jobId: r.jobId ?? null,
    dreamId: r.dreamId ?? null,
  });
  if (r.jobId && r.costUsd > 0) {
    await db
      .update(generationJobs)
      .set({ actualCostUsd: sql`${generationJobs.actualCostUsd} + ${Number(r.costUsd.toFixed(4))}` })
      .where(eq(generationJobs.id, r.jobId));
  }
}

export async function todaysSpend(): Promise<{ total: number; free: number }> {
  const db = getDb();
  const since = startOfUtcDay();
  const [total] = await db.select({ v: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float` }).from(aiUsage).where(gte(aiUsage.createdAt, since));
  // Free spend = generations paid by the free allowance + free preview frames (image calls without a job).
  const [free] = await db
    .select({ v: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float` })
    .from(aiUsage)
    .leftJoin(generationJobs, eq(generationJobs.id, aiUsage.jobId))
    .where(and(gte(aiUsage.createdAt, since), sql`(${generationJobs.usedFreeAllowance} = true or (${aiUsage.jobId} is null and ${aiUsage.kind} = 'image'))`));
  return { total: Number(total?.v ?? 0), free: Number(free?.v ?? 0) };
}

/** Rejects new work when the configured daily AI budget is exhausted. */
export async function assertSpendBudget(estimatedUsd: number, opts: { free: boolean }): Promise<void> {
  const { limits } = await getSettings();
  const spend = await todaysSpend();
  if (limits.dailySpendLimitUsd > 0 && spend.total + estimatedUsd > limits.dailySpendLimitUsd) {
    throw new AppError("spend_limit_reached", "Daily AI budget reached");
  }
  if (opts.free && limits.freeDailySpendLimitUsd > 0 && spend.free + estimatedUsd > limits.freeDailySpendLimitUsd) {
    throw new AppError("spend_limit_reached", "Daily free-tier budget reached");
  }
}
