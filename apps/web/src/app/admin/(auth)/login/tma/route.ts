import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@dream/core/errors";
import { hitRateLimit } from "@dream/core/redis";
import { audit } from "@dream/core/services/admin-auth";
import { isAdminTelegramId } from "@dream/core/services/users";
import { isDevUserId } from "@dream/core/telegram/init-data";
import { readInitData } from "@/server/auth";
import { ADMIN_COOKIE, adminCookieOptions, signAdminToken } from "@/server/admin/session";

export const dynamic = "force-dynamic";

/**
 * Admin sign-in from inside the Telegram Mini App. Requires the verified
 * `Authorization: tma <initData>` header (custom headers cannot be sent by
 * cross-site navigations, so this is not CSRF-able).
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    const rl = await hitRateLimit(`admin-tma:${ip}`, 30, 600);
    if (!rl.allowed) return NextResponse.json({ error: { code: "rate_limited" } }, { status: 429 });
    const initData = readInitData(req);
    // Development identities (browser outside Telegram) can never become admins.
    if (isDevUserId(initData.user.id) || !(await isAdminTelegramId(initData.user.id))) {
      return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
    }
    const token = await signAdminToken(initData.user.id);
    const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
    await audit(initData.user.id, "admin.login", undefined, { method: "mini_app" }, ip).catch(() => undefined);
    return res;
  } catch (err) {
    if (isAppError(err) && err.code === "unauthorized") return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
    return NextResponse.json({ error: { code: "internal" } }, { status: 500 });
  }
}
