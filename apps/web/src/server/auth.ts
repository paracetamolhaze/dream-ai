import "server-only";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { devAuthEnabled, env, mediaSigningSecret } from "@dream/core/env";
import { AppError } from "@dream/core/errors";
import { hitRateLimit } from "@dream/core/redis";
import { InitDataValidationError, isDevUserId, signInitData, validateInitData, type TelegramWebAppUser, type ValidatedInitData } from "@dream/core/telegram/init-data";
import { assertActive, getUserByTelegramId, upsertTelegramUser, type UserRow } from "@dream/core/services/users";
import { getDb } from "@dream/core/db/client";
import { users } from "@dream/core/db/schema";

/**
 * Mini App authentication. Every API request carries the raw Telegram
 * initData in `Authorization: tma <initData>`; the server verifies the HMAC
 * signature with the bot token and the auth_date freshness. Nothing about the
 * user's identity is trusted from the client otherwise.
 */

/** Separate secret for development identities — never the bot token. */
function devInitDataSecret(): string {
  return `dev-initdata:${mediaSigningSecret()}`;
}

/** DEVELOPMENT ONLY: signs an identity in the reserved dev id range. */
export function signDevInitData(fields: { user: TelegramWebAppUser; startParam?: string }): string {
  if (!devAuthEnabled()) throw new AppError("forbidden", "Dev auth disabled");
  if (!isDevUserId(fields.user.id)) throw new AppError("validation_failed", "Dev identities must use the reserved id range");
  return signInitData(fields, devInitDataSecret());
}

export function readInitData(req: NextRequest): ValidatedInitData {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "tma" || rest.length === 0) throw new AppError("unauthorized", "Missing Telegram authorization");
  const raw = rest.join(" ");
  const maxAge = env().INIT_DATA_MAX_AGE_SEC;
  let reason = "invalid";
  const token = env().TELEGRAM_BOT_TOKEN;
  if (token) {
    try {
      return validateInitData(raw, token, maxAge);
    } catch (err) {
      if (!(err instanceof InitDataValidationError)) throw err;
      reason = err.reason;
    }
  }
  if (devAuthEnabled()) {
    try {
      const v = validateInitData(raw, devInitDataSecret(), maxAge);
      if (isDevUserId(v.user.id)) return v;
    } catch (err) {
      if (!(err instanceof InitDataValidationError)) throw err;
      if (!token) reason = err.reason;
    }
  }
  throw new AppError("unauthorized", `Telegram authorization ${reason}`);
}

export interface AuthContext {
  user: UserRow;
  initData: ValidatedInitData;
}

/**
 * Authenticates the request, creating the user on first contact. Rate limits
 * per user and per endpoint class (`bucket`), so frequent polling of one
 * endpoint never exhausts the budget of another.
 */
export async function authenticate(req: NextRequest, opts: { allowInactive?: boolean; rateLimit?: number; bucket?: string } = {}): Promise<AuthContext> {
  const initData = readInitData(req);
  const limit = opts.rateLimit ?? 240;
  const bucket = opts.bucket ?? (opts.rateLimit ? `l${opts.rateLimit}` : "default");
  const rl = await hitRateLimit(`api:${bucket}:${initData.user.id}`, limit, 60);
  if (!rl.allowed) throw new AppError("rate_limited", "Too many requests");
  let user = await getUserByTelegramId(initData.user.id);
  if (!user) {
    user = (await upsertTelegramUser(initData.user, { startParam: initData.startParam })).user;
  } else if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
    await getDb().update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  }
  if (!opts.allowInactive) assertActive(user);
  return { user, initData };
}
