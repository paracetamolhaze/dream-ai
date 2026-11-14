import { closeDb } from "./client";
import { runMigrations } from "./migrate";
import { seedDefaults } from "./seed";
import { ensureBucket } from "../storage";
import { logger } from "../logger";

/** One-shot: migrations + default seed + bucket. Used by the `migrate` compose service. */
async function main() {
  await runMigrations();
  await seedDefaults();
  if (process.env.SKIP_BUCKET !== "1") {
    try {
      await ensureBucket();
      logger.info("storage bucket ready");
    } catch (err) {
      logger.error("bucket setup failed", { error: (err as Error).message });
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    logger.error("migration failed", { error: err });
    process.exitCode = 1;
  })
  .finally(() => closeDb());
