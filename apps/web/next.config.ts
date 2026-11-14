import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Works whether `next` is started from apps/web or from the monorepo root (`next dev apps/web`).
const appDir = existsSync(path.join(process.cwd(), "next.config.ts")) ? process.cwd() : path.join(process.cwd(), "apps/web");
const repoRoot = path.join(appDir, "../..");

// Local development: reuse the monorepo-level .env (Docker/production inject env vars directly).
if (process.env.NODE_ENV !== "production") {
  const rootEnv = path.join(repoRoot, ".env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

const config: NextConfig = {
  output: "standalone",
  // Monorepo root so the standalone bundle includes workspace packages.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@dream/core"],
  serverExternalPackages: ["pg", "ioredis", "bullmq", "grammy", "@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner", "@anthropic-ai/sdk"],
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Mini Apps are embedded by Telegram Web clients — allow only them as frame ancestors.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default config;
