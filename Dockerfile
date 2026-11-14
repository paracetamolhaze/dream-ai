# syntax=docker/dockerfile:1.7
# Multi-stage build for all DREAM AI services. Targets: web, bot, worker.

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false

# ── Dependencies (dev + prod) ──────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
RUN npm ci --no-audit --no-fund

# ── Build ──────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npm run build -w @dream/web \
 && npm run build -w @dream/bot \
 && npm run build -w @dream/worker

# ── Production node_modules for bot/worker (bundles inline @dream/core) ─────
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev --no-audit --no-fund

# ── web: Next.js standalone server (Mini App + API + admin) ────────────────
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ── bot: grammY webhook/polling service ────────────────────────────────────
FROM node:24-alpine AS bot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY apps/bot/package.json ./apps/bot/package.json
WORKDIR /app/apps/bot
USER node
EXPOSE 8081
CMD ["node", "dist/index.js"]

# ── worker: BullMQ generation pipeline + FFmpeg (also runs migrations) ─────
FROM node:24-alpine AS worker
RUN apk add --no-cache ffmpeg font-dejavu
WORKDIR /app
ENV NODE_ENV=production \
    FONT_PATH=/usr/share/fonts/dejavu/DejaVuSans.ttf \
    WORK_DIR=/tmp/dream-work
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/drizzle ./apps/worker/drizzle
COPY apps/worker/package.json ./apps/worker/package.json
RUN mkdir -p /tmp/dream-work && chown node:node /tmp/dream-work
WORKDIR /app/apps/worker
USER node
EXPOSE 8082
CMD ["node", "dist/index.js"]
