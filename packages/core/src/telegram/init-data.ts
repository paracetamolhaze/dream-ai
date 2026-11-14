import { createHmac } from "node:crypto";
import { safeEqual } from "../utils";

/**
 * Validation of Telegram Mini App initData, as documented in
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key="WebAppData", data=<bot_token>)
 *   hash       = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
 */

/**
 * Development identities (browser outside Telegram, ALLOW_DEV_AUTH only) use a
 * reserved id range above any real Telegram user id, and are signed with a
 * separate secret — so they can never impersonate a real account or an admin.
 */
export const DEV_USER_ID_MIN = 900_000_000_000;
export const isDevUserId = (id: number) => id >= DEV_USER_ID_MIN;

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface ValidatedInitData {
  user: TelegramWebAppUser;
  authDate: Date;
  startParam?: string;
  queryId?: string;
  chatType?: string;
}

export type InitDataError = "missing" | "malformed" | "bad_hash" | "expired" | "no_user";

export class InitDataValidationError extends Error {
  constructor(readonly reason: InitDataError) {
    super(`initData validation failed: ${reason}`);
  }
}

function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  return pairs.join("\n");
}

function computeHash(dataCheckString: string, botToken: string): string {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

export function validateInitData(raw: string | null | undefined, botToken: string, maxAgeSec: number, now: Date = new Date()): ValidatedInitData {
  if (!raw) throw new InitDataValidationError("missing");
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    throw new InitDataValidationError("malformed");
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataValidationError("malformed");

  const expected = computeHash(buildDataCheckString(params), botToken);
  if (!safeEqual(expected, hash)) throw new InitDataValidationError("bad_hash");

  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataValidationError("malformed");
  const ageSec = now.getTime() / 1000 - authDateSec;
  // Allow 60s of clock skew into the future.
  if (ageSec > maxAgeSec || ageSec < -60) throw new InitDataValidationError("expired");

  const userRaw = params.get("user");
  if (!userRaw) throw new InitDataValidationError("no_user");
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new InitDataValidationError("malformed");
  }
  if (typeof user.id !== "number") throw new InitDataValidationError("no_user");

  return {
    user,
    authDate: new Date(authDateSec * 1000),
    startParam: params.get("start_param") ?? undefined,
    queryId: params.get("query_id") ?? undefined,
    chatType: params.get("chat_type") ?? undefined,
  };
}

/**
 * Builds a correctly signed initData string. Used by tests and by the
 * development-only browser login (never enabled in production).
 */
export function signInitData(fields: { user: TelegramWebAppUser; authDate?: Date; startParam?: string }, botToken: string): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor((fields.authDate ?? new Date()).getTime() / 1000)));
  params.set("user", JSON.stringify(fields.user));
  if (fields.startParam) params.set("start_param", fields.startParam);
  params.set("hash", computeHash(buildDataCheckString(params), botToken));
  return params.toString();
}
