import pg from "pg";

/**
 * Creates the dream_test database (if Postgres is reachable) and applies
 * migrations + seed. Integration suites check INTEGRATION=1 and skip otherwise.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://dream:dream@localhost:5432/dream_test";
  const admin = new URL(url);
  const dbName = admin.pathname.slice(1);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const exists = await client.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await client.query(`create database "${dbName}"`);
    await client.end();
  } catch (err) {
    process.env.INTEGRATION = "0";
    console.warn(`[tests] Postgres not reachable (${(err as Error).message}) — integration tests will be skipped`);
    return;
  }
  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
  process.env.S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? "http://localhost:9000";
  process.env.S3_ACCESS_KEY_ID = "dreamminio";
  process.env.S3_SECRET_ACCESS_KEY = "dreamminio-secret";
  process.env.S3_BUCKET = "dream-test";
  process.env.LOG_LEVEL = "error";
  const { runMigrations } = await import("../src/db/migrate");
  const { seedDefaults } = await import("../src/db/seed");
  const { ensureBucket } = await import("../src/storage");
  const { closeDb } = await import("../src/db/client");
  await runMigrations();
  await seedDefaults();
  try {
    await ensureBucket();
    process.env.S3_AVAILABLE = "1";
  } catch {
    process.env.S3_AVAILABLE = "0";
  }
  await closeDb();
  process.env.INTEGRATION = "1";
}
