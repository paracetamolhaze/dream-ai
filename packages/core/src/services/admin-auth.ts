import { getDb } from "../db/client";
import { adminAuditLogs } from "../db/schema";
import { adminSessionSecret } from "../env";
import { getRedis } from "../redis";
import { hmacSha256, randomToken, safeEqual } from "../utils";
import { isAdminTelegramId } from "./users";

/**
 * Admin sign-in: the bot sends a one-time magic link (/admin command, only for
 * allow-listed Telegram ids). The web app exchanges it for an HttpOnly session
 * cookie (signed JWT, see apps/web). Every admin request re-checks the
 * allow-list on the server — the client never decides who is an admin.
 */

const TOKEN_TTL_SEC = 600;

export async function createAdminLoginToken(telegramId: number): Promise<string | null> {
  if (!(await isAdminTelegramId(telegramId))) return null;
  const nonce = randomToken(18);
  const sig = hmacSha256(adminSessionSecret(), `admin-login.${telegramId}.${nonce}`).toString("base64url");
  await getRedis().set(`admin-login:${nonce}`, String(telegramId), "EX", TOKEN_TTL_SEC);
  return `${telegramId}.${nonce}.${sig}`;
}

/** Validates and consumes a magic link token. Returns the admin Telegram id. */
export async function consumeAdminLoginToken(token: string): Promise<number | null> {
  const [tid, nonce, sig] = token.split(".");
  if (!tid || !nonce || !sig) return null;
  const telegramId = Number(tid);
  if (!Number.isSafeInteger(telegramId)) return null;
  const expected = hmacSha256(adminSessionSecret(), `admin-login.${telegramId}.${nonce}`).toString("base64url");
  if (!safeEqual(expected, sig)) return null;
  const stored = await getRedis().getdel(`admin-login:${nonce}`);
  if (stored !== String(telegramId)) return null;
  if (!(await isAdminTelegramId(telegramId))) return null;
  return telegramId;
}

export async function audit(adminTelegramId: number, action: string, target?: { type: string; id: string }, payload?: Record<string, unknown>, ip?: string | null) {
  await getDb()
    .insert(adminAuditLogs)
    .values({ adminTelegramId, action, targetType: target?.type, targetId: target?.id, payload: payload ?? null, ip: ip ?? null });
}
