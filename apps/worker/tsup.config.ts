import { cp, rm } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  // Workspace sources are bundled; every third-party package stays a runtime dependency
  // (resolved from node_modules) — bundling pg/ioredis/aws-sdk into ESM breaks their dynamic requires.
  noExternal: [/^@dream\//],
  external: [/^(?!@dream\/)(?![./])(?!node:)[^:]+$/],
  async onSuccess() {
    await rm("drizzle", { recursive: true, force: true });
    await cp("../../packages/core/drizzle", "drizzle", { recursive: true });
  },
});
