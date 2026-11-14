import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

declare global {
  // eslint-disable-next-line no-var
  var __dreamDb: { pool: pg.Pool; db: Database } | undefined;
}

// Return BIGINT (int8) as JS numbers — Telegram ids fit in 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

function create(): { pool: pg.Pool; db: Database } {
  const e = env();
  const pool = new pg.Pool({
    connectionString: e.DATABASE_URL,
    max: e.DATABASE_POOL_SIZE,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    process.stderr.write(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message }) + "\n");
  });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Lazily created singleton (survives Next.js dev hot reloads). */
export function getDb(): Database {
  if (!globalThis.__dreamDb) globalThis.__dreamDb = create();
  return globalThis.__dreamDb.db;
}

export function getPool(): pg.Pool {
  if (!globalThis.__dreamDb) globalThis.__dreamDb = create();
  return globalThis.__dreamDb.pool;
}

export async function closeDb(): Promise<void> {
  if (globalThis.__dreamDb) {
    await globalThis.__dreamDb.pool.end();
    globalThis.__dreamDb = undefined;
  }
}

export { schema };
