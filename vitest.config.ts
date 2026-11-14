import { defineConfig } from "vitest/config";

/**
 * Unit tests run anywhere. Integration tests need the local infra:
 *   docker compose up -d postgres redis minio
 * They use a separate database (dream_test) and Redis DB 15, so dev data is untouched.
 */
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    globalSetup: ["packages/core/test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      APP_ENV: "development",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://dream:dream@localhost:5432/dream_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15",
      S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://localhost:9000",
      S3_ACCESS_KEY_ID: "dreamminio",
      S3_SECRET_ACCESS_KEY: "dreamminio-secret",
      S3_BUCKET: "dream-test",
      DEMO_MODE: "true",
      MEDIA_SIGNING_SECRET: "test-media-secret",
      ADMIN_SESSION_SECRET: "test-admin-secret",
      LOG_LEVEL: "error",
      TELEGRAM_BOT_TOKEN: "",
    },
  },
});
