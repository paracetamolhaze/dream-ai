import { sql } from "drizzle-orm";
import { getDb } from "@dream/core/db/client";
import { getRedis } from "@dream/core/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = { db: false, redis: false };
  try {
    await getDb().execute(sql`select 1`);
    checks.db = true;
  } catch {
    /* reported below */
  }
  try {
    checks.redis = (await getRedis().ping()) === "PONG";
  } catch {
    /* reported below */
  }
  const ok = checks.db && checks.redis;
  return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
