// One-shot entry for the `migrate` container: SQL migrations, default seed, storage bucket.
// MIGRATIONS_DIR (or ./drizzle next to the working directory) must contain the drizzle folder —
// the build copies packages/core/drizzle into apps/worker/drizzle.
import "@dream/core/db/migrate-cli";
