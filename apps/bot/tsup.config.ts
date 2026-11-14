import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundle the workspace package (TypeScript sources); every third-party package stays a
  // runtime dependency resolved from node_modules (bundling pg/ioredis/aws-sdk breaks their dynamic requires).
  noExternal: [/^@dream\//],
  external: [/^(?!@dream\/)(?![./])(?!node:)[^:]+$/],
});
