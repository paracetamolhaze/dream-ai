import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./client";
import { logger } from "../logger";

function migrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "packages/core/drizzle"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle"),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(path.join(p, "meta", "_journal.json")));
  if (!found) throw new Error(`Drizzle migrations folder not found (tried: ${candidates.join(", ")})`);
  return found;
}

/** Applies pending SQL migrations. Uses an advisory lock so parallel containers don't race. */
export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await client.query("create extension if not exists pg_trgm");
    await migrate(getDb(), { migrationsFolder: migrationsFolder() });
    logger.info("migrations applied");
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
}
