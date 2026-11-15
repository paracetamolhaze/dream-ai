import http from "node:http";
import { webhookCallback } from "grammy";
import { env, publicApiUrl } from "@dream/core/env";
import { logger } from "@dream/core/logger";
import { closeDb } from "@dream/core/db/client";
import { closeQueues } from "@dream/core/queue";
import { closeRedis, getRedis } from "@dream/core/redis";
import { sleep } from "@dream/core/utils";
import { ALLOWED_UPDATES, configureBot, createBot, inFlightUpdates } from "./bot";

const log = logger.child({ svc: "bot" });

// A handler that finishes after the webhook timeout must not take the process down.
process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", { error: reason }));

async function main() {
  const e = env();
  let healthy = true;
  let mode: string = e.BOT_MODE;

  const token = e.TELEGRAM_BOT_TOKEN;
  if (!token) {
    mode = "disabled";
    log.warn("TELEGRAM_BOT_TOKEN is not set — bot is disabled (the rest of the stack keeps working)");
  }
  if (token && e.BOT_MODE === "webhook" && !e.TELEGRAM_WEBHOOK_SECRET) {
    // Without the secret anyone could post fake updates (e.g. fake payments) to the webhook.
    throw new Error("BOT_MODE=webhook requires TELEGRAM_WEBHOOK_SECRET");
  }
  const bot = token ? createBot(token) : null;
  const webhookPath = e.TELEGRAM_WEBHOOK_PATH;
  const handle = bot && e.BOT_MODE === "webhook" ? webhookCallback(bot, "http", { secretToken: e.TELEGRAM_WEBHOOK_SECRET, onTimeout: "return", timeoutMilliseconds: 9_000 }) : null;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      let redisOk = false;
      try {
        redisOk = (await getRedis().ping()) === "PONG";
      } catch {
        redisOk = false;
      }
      res.writeHead(healthy && redisOk ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: healthy && redisOk, mode }));
      return;
    }
    if (handle && req.method === "POST" && req.url?.split("?")[0] === webhookPath) {
      try {
        await handle(req, res);
      } catch (err) {
        log.error("webhook handling failed", { error: err });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(e.BOT_PORT, () => log.info("bot http server listening", { port: e.BOT_PORT, mode }));

  if (bot) {
    await bot.init();
    log.info("bot initialized", { username: bot.botInfo.username });
    await configureBot(bot).catch((err) => log.warn("bot configuration failed", { error: (err as Error).message }));
    if (e.BOT_MODE === "webhook") {
      const url = `${publicApiUrl()}${webhookPath}`;
      await bot.api.setWebhook(url, { secret_token: e.TELEGRAM_WEBHOOK_SECRET, allowed_updates: [...ALLOWED_UPDATES], max_connections: 40 });
      log.info("webhook registered", { url });
    } else {
      await bot.api.deleteWebhook();
      void bot.start({ allowed_updates: [...ALLOWED_UPDATES], onStart: () => log.info("long polling started") }).catch((err) => {
        // Let the container restart policy bring polling back.
        healthy = false;
        log.error("polling stopped — exiting", { error: err });
        process.exit(1);
      });
    }
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    healthy = false;
    server.close();
    if (bot && e.BOT_MODE === "polling") await bot.stop().catch(() => undefined);
    // Let updates that are being handled finish (payments in particular).
    for (let i = 0; i < 40 && inFlightUpdates() > 0; i++) await sleep(250);
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("bot failed to start", { error: err });
  process.exit(1);
});
