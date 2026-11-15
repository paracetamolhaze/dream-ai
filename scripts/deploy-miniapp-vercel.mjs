#!/usr/bin/env node
/**
 * Builds the Mini App UI as a static site and deploys it to Vercel.
 *
 * Vercel only serves static files from its CDN: no serverless functions, no SSR,
 * no image optimization, no build minutes (the build runs locally). The browser
 * talks to the backend API directly (CORS), and media is streamed from the backend,
 * so neither API traffic nor video bandwidth goes through Vercel.
 *
 * Usage:
 *   VERCEL_TOKEN=… node scripts/deploy-miniapp-vercel.mjs --api https://api.example.com [--bot my_bot] [--project sonnik-miniapp] [--build-only]
 * Env fallbacks: MINIAPP_API_URL (or PUBLIC_API_URL), TELEGRAM_BOT_USERNAME, VERCEL_PROJECT.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiUrl = (arg("api") ?? process.env.MINIAPP_API_URL ?? process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
const bot = arg("bot") ?? process.env.TELEGRAM_BOT_USERNAME ?? "";
const project = arg("project") ?? process.env.VERCEL_PROJECT ?? "sonnik-miniapp";
const buildOnly = args.includes("--build-only");
if (!/^https:\/\//.test(apiUrl)) {
  console.error("--api https://<backend origin> is required (the Mini App calls the API there)");
  process.exit(1);
}

// 1. Copy the UI into an isolated build dir (no API routes, admin, share pages or server code).
const src = path.join(root, "apps/web");
const work = path.join(root, ".miniapp-build/web");
rmSync(path.join(root, ".miniapp-build"), { recursive: true, force: true });
const exclude = new Set(["node_modules", ".next", "out", "package.json", "tsconfig.tsbuildinfo", "next-env.d.ts", "AGENTS.md"]);
const excludePaths = ["src/app/api", "src/app/admin", "src/app/s", "src/server", "src/proxy.ts"].map((p) => path.join(src, p));
cpSync(src, work, {
  recursive: true,
  filter: (from) => !exclude.has(path.basename(from)) && !excludePaths.some((p) => from === p || from.startsWith(p + path.sep)),
});

// 2. Static export build (Turbopack resolves dependencies from the monorepo root).
console.log(`Building static Mini App → API ${apiUrl}`);
const build = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], {
  cwd: work,
  stdio: "inherit",
  env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_API_URL: apiUrl, NEXT_PUBLIC_BOT_USERNAME: bot, NEXT_PUBLIC_DEV_AUTH: "0", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

// 3. Deploy directory named after the Vercel project (keeps its .vercel link between runs).
const deployDir = path.join(root, ".miniapp-deploy", project);
mkdirSync(deployDir, { recursive: true });
for (const entry of readdirSync(deployDir)) if (entry !== ".vercel") rmSync(path.join(deployDir, entry), { recursive: true, force: true });
cpSync(path.join(work, "out"), deployDir, { recursive: true });
writeFileSync(
  path.join(deployDir, "vercel.json"),
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      cleanUrls: true,
      trailingSlash: false,
      headers: [
        { source: "/_next/static/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
        {
          source: "/(.*)",
          headers: [
            { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ],
        },
      ],
    },
    null,
    2,
  ),
);
const files = readdirSync(deployDir, { recursive: true }).length;
console.log(`Static output ready: ${deployDir} (${files} entries)`);
if (buildOnly) process.exit(0);

// 4. Upload to Vercel (static files only — nothing to build or run there).
const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("VERCEL_TOKEN is not set");
  process.exit(1);
}
const out = execFileSync("npx", ["--yes", "vercel@65.16.0", "deploy", "--prod", "--yes", "--token", token], {
  cwd: deployDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  shell: process.platform === "win32",
});
console.log(out.trim());
if (!existsSync(path.join(deployDir, ".vercel"))) console.warn("Vercel project link not found — the next deploy will create/link again.");
