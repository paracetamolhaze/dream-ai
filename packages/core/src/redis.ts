import { Redis } from "ioredis";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __dreamRedis: Redis | undefined;
}

/** Shared Redis connection for app-level use (rate limits, dedupe, locks). */
export function getRedis(): Redis {
  if (!globalThis.__dreamRedis) {
    globalThis.__dreamRedis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false, enableReadyCheck: true });
  }
  return globalThis.__dreamRedis;
}

/** New connection with settings required by BullMQ workers (blocking commands). */
export function createBullConnection(): Redis {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export async function closeRedis(): Promise<void> {
  if (globalThis.__dreamRedis) {
    await globalThis.__dreamRedis.quit().catch(() => undefined);
    globalThis.__dreamRedis = undefined;
  }
}

/**
 * Fixed-window rate limiter. Returns remaining requests or throws when exceeded.
 */
export async function hitRateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }> {
  const redis = getRedis();
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const results = await redis.multi().incr(k).expire(k, windowSec + 1).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec: windowSec - (Math.floor(Date.now() / 1000) % windowSec) };
}

/** Returns true the first time a key is seen within the TTL (dedupe for Telegram updates etc.). */
export async function markOnce(key: string, ttlSec: number): Promise<boolean> {
  const res = await getRedis().set(`once:${key}`, "1", "EX", ttlSec, "NX");
  return res === "OK";
}
