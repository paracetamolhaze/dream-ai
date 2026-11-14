import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/db/client";
import { creditTransactions, generationJobs, users } from "../src/db/schema";
import { closeQueues } from "../src/queue";
import { closeRedis, getRedis } from "../src/redis";
import { applyCreditChange, captureJobCredits, releaseJobCredits } from "../src/services/credits";
import { cancelJob, startGeneration } from "../src/services/generation";
import { deleteDream } from "../src/services/dreams";
import { createReadyDream, createUser, getUserRow, integration } from "./helpers";

describe.skipIf(!integration)("credits: reservation, capture, release", () => {
  afterAll(async () => {
    await closeQueues();
    await closeRedis();
    await closeDb();
  });

  it("never lets the balance go negative under concurrent spending", async () => {
    const u = await createUser({ creditsBalance: 30 });
    const attempts = Array.from({ length: 10 }, () =>
      getDb().transaction((tx) => applyCreditChange(tx, { userId: u.id, amount: -10, reservedDelta: 10, type: "reserve", source: "test" })),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3);
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(0);
    expect(after.creditsReserved).toBe(30);
    const ledger = await getDb().select().from(creditTransactions).where(eq(creditTransactions.userId, u.id));
    expect(ledger.reduce((s, t) => s + t.amount, 0)).toBe(after.creditsBalance - 30);
  });

  it("reserves on start, refuses duplicates, and is idempotent per key", async () => {
    await getRedis().flushdb();
    const u = await createUser({ creditsBalance: 100, freeSlideshowsUsed: 1 });
    const d = await createReadyDream(u.id);
    const body = { format: "slideshow" as const, styleId: "cinematic", idempotencyKey: `k-${u.id}`, locale: "ru" as const };
    const job = await startGeneration(u, d.id, body);
    expect(job.creditState).toBe("reserved");
    expect(job.creditsCost).toBeGreaterThan(0);
    // Same idempotency key → same job, no second charge.
    const again = await startGeneration(await getUserRow(u.id), d.id, body);
    expect(again.id).toBe(job.id);
    // Different key while the first is active → rejected.
    await expect(startGeneration(await getUserRow(u.id), d.id, { ...body, idempotencyKey: `k2-${u.id}` })).rejects.toMatchObject({ code: "job_already_running" });
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(100 - job.creditsCost);
    expect(after.creditsReserved).toBe(job.creditsCost);
  });

  it("returns reserved credits exactly once on final failure", async () => {
    const u = await createUser({ creditsBalance: 100, freeSlideshowsUsed: 1 });
    const d = await createReadyDream(u.id);
    const job = await startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `f-${u.id}`, locale: "ru" });
    await getDb().update(generationJobs).set({ status: "failed" }).where(eq(generationJobs.id, job.id));
    const [r1, r2] = await Promise.all([releaseJobCredits(job.id, "test"), releaseJobCredits(job.id, "test")]);
    expect(r1.released + r2.released).toBe(job.creditsCost);
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(100);
    expect(after.creditsReserved).toBe(0);
    const releases = await getDb()
      .select()
      .from(creditTransactions)
      .where(and(eq(creditTransactions.jobId, job.id), eq(creditTransactions.type, "release")));
    expect(releases).toHaveLength(1);
    // A released job can no longer be captured.
    await captureJobCredits(job.id);
    expect((await getUserRow(u.id)).creditsBalance).toBe(100);
  });

  it("captures reserved credits on success", async () => {
    const u = await createUser({ creditsBalance: 50, freeSlideshowsUsed: 1 });
    const d = await createReadyDream(u.id);
    const job = await startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `c-${u.id}`, locale: "ru" });
    await captureJobCredits(job.id);
    await captureJobCredits(job.id);
    const after = await getUserRow(u.id);
    expect(after.creditsReserved).toBe(0);
    expect(after.creditsBalance).toBe(50 - job.creditsCost);
  });

  it("rejects generation without credits and creates no job", async () => {
    const u = await createUser({ creditsBalance: 0, freeSlideshowsUsed: 5 });
    const d = await createReadyDream(u.id);
    await expect(startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `n-${u.id}`, locale: "ru" })).rejects.toMatchObject({ code: "insufficient_credits" });
    const jobs = await getDb().select().from(generationJobs).where(eq(generationJobs.dreamId, d.id));
    expect(jobs).toHaveLength(0);
    expect((await getUserRow(u.id)).freeSlideshowsUsed).toBe(5);
  });

  it("uses the free slideshow allowance once and returns it on failure", async () => {
    const u = await createUser({ creditsBalance: 0 });
    const d = await createReadyDream(u.id);
    const job = await startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `free-${u.id}`, locale: "ru" });
    expect(job.usedFreeAllowance).toBe(true);
    expect(job.creditsCost).toBe(0);
    expect((await getUserRow(u.id)).freeSlideshowsUsed).toBe(1);
    await releaseJobCredits(job.id, "failed");
    expect((await getUserRow(u.id)).freeSlideshowsUsed).toBe(0);
  });

  it("cancelling a job returns its credits atomically, and only once", async () => {
    const u = await createUser({ creditsBalance: 100, freeSlideshowsUsed: 1 });
    const d = await createReadyDream(u.id);
    const job = await startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `cx-${u.id}`, locale: "ru" });
    const results = await Promise.allSettled([cancelJob(u, job.id), cancelJob(u, job.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(row!.status).toBe("cancelled");
    expect(row!.creditState).toBe("released");
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(100);
    expect(after.creditsReserved).toBe(0);
  });

  it("deleting a dream cancels its running generation and refunds immediately", async () => {
    const u = await createUser({ creditsBalance: 100, freeSlideshowsUsed: 1 });
    const d = await createReadyDream(u.id);
    const job = await startGeneration(u, d.id, { format: "slideshow", styleId: "cinematic", idempotencyKey: `del-${u.id}`, locale: "ru" });
    expect((await getUserRow(u.id)).creditsReserved).toBe(job.creditsCost);
    await deleteDream(u, d.id);
    const [row] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(row!.status).toBe("cancelled");
    expect(row!.creditState).toBe("released");
    const after = await getUserRow(u.id);
    expect(after.creditsBalance).toBe(100);
    expect(after.creditsReserved).toBe(0);
  });

  it("only offers video durations the provider supports", async () => {
    const u = await createUser({ creditsBalance: 1000 });
    const d = await createReadyDream(u.id, { scenes: 6 });
    await expect(startGeneration(u, d.id, { format: "video", styleId: "cinematic", targetDurationSec: 7, idempotencyKey: `v7-${u.id}`, locale: "ru" })).rejects.toMatchObject({ code: "validation_failed" });
    const job = await startGeneration(u, d.id, { format: "video", styleId: "cinematic", targetDurationSec: 30, idempotencyKey: `v30-${u.id}`, locale: "ru" });
    expect(job.mediaType).toBe("video");
    const [row] = await getDb().select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(row!.options.targetDurationSec).toBe(30);
    const [user] = await getDb().select().from(users).where(eq(users.id, u.id));
    expect(user!.creditsReserved).toBe(job.creditsCost);
  });
});
