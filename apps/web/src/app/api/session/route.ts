import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildSession } from "@dream/core/services/profile";
import { upsertTelegramUser } from "@dream/core/services/users";
import { track } from "@dream/core/services/analytics";
import { readInitData } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { AppError } from "@dream/core/errors";
import { hitRateLimit } from "@dream/core/redis";

export const dynamic = "force-dynamic";

const Body = z.object({
  inTelegram: z.boolean().optional(),
  platform: z.string().max(32).optional(),
});

/** Mini App bootstrap: verifies initData, creates/refreshes the user, resolves deep links, records `app_open`. */
export const POST = handler(async (req: NextRequest) => {
  const initData = readInitData(req);
  const rl = await hitRateLimit(`session:${initData.user.id}`, 30, 60);
  if (!rl.allowed) throw new AppError("rate_limited", "Too many requests");
  const body = await readJson(req, Body);
  const { user, isNew } = await upsertTelegramUser(initData.user, { startParam: initData.startParam });
  if (user.status === "banned" || user.status === "restricted") throw new AppError("account_restricted", "Account restricted");
  if (user.status === "deleted") throw new AppError("unauthorized", "Account deleted");
  await track(
    "app_open",
    user.id,
    { new: isNew, startParam: initData.startParam ?? null, inTelegram: body.inTelegram ?? null, platform: body.platform ?? null },
    { source: "client" },
  );
  return json(await buildSession(user, initData.startParam));
});
