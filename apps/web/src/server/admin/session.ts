import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminSessionSecret, isProduction } from "@dream/core/env";
import { AppError } from "@dream/core/errors";
import { getAdminRole, roleAtLeast, type AdminRole } from "@dream/core/services/admin-ops";
import { isAdminTelegramId } from "@dream/core/services/users";

/**
 * Admin session: HS256 JWT in an HttpOnly cookie scoped to /admin.
 * The cookie only proves *who* signed in; on every request the Telegram id is
 * re-checked against the admin allow-list (env + admin_users), so removing an
 * admin revokes access immediately.
 */

export const ADMIN_COOKIE = "dream_admin";
const TTL_SEC = 12 * 3600;
const ISSUER = "dream-ai";
const AUDIENCE = "dream-admin";

export interface AdminSession {
  telegramId: number;
  role: AdminRole;
  issuedAt: Date;
}

function key(): Uint8Array {
  return new TextEncoder().encode(adminSessionSecret());
}

export async function signAdminToken(telegramId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(telegramId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .sign(key());
}

function isProductionSafe(): boolean {
  try {
    return isProduction();
  } catch {
    return process.env.APP_ENV === "production";
  }
}

export function adminCookieOptions(maxAge = TTL_SEC) {
  return { httpOnly: true, secure: isProductionSafe(), sameSite: "lax" as const, path: "/admin", maxAge };
}

/** Sets the session cookie (server actions and route handlers only). */
export async function startAdminSession(telegramId: number): Promise<void> {
  const token = await signAdminToken(telegramId);
  (await cookies()).set(ADMIN_COOKIE, token, adminCookieOptions());
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, "", adminCookieOptions(0));
}

async function verify(token: string): Promise<{ telegramId: number; issuedAt: Date } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    const telegramId = Number(payload.sub);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null;
    return { telegramId, issuedAt: new Date((payload.iat ?? 0) * 1000) };
  } catch {
    return null;
  }
}

/**
 * Current admin or null. Re-validates the allow-list on every request
 * (memoized only within a single server render via React cache()).
 */
export const readAdminSession = cache(async (): Promise<AdminSession | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const v = await verify(token);
  if (!v) return null;
  if (!(await isAdminTelegramId(v.telegramId))) return null;
  const role = await getAdminRole(v.telegramId);
  if (!role) return null;
  return { telegramId: v.telegramId, role, issuedAt: v.issuedAt };
});

/**
 * Guard for admin pages and server actions. Unauthenticated → redirect to the
 * login page; insufficient role → AppError("forbidden").
 */
export async function requireAdmin(minRole: AdminRole = "support"): Promise<AdminSession> {
  const session = await readAdminSession();
  if (!session) redirect("/admin/login");
  if (!roleAtLeast(session.role, minRole)) throw new AppError("forbidden", "Insufficient admin role");
  return session;
}

/**
 * Guard for pages: like requireAdmin, but an insufficient role redirects to the
 * dashboard with a notice instead of throwing (error messages are redacted in
 * production builds, so a redirect gives a clearer result).
 */
export async function requireAdminPage(minRole: AdminRole = "support"): Promise<AdminSession> {
  const session = await readAdminSession();
  if (!session) redirect("/admin/login");
  if (!roleAtLeast(session.role, minRole)) redirect("/admin?denied=1");
  return session;
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
