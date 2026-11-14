import type { NextRequest } from "next/server";
import { devAuthEnabled } from "@dream/core/env";
import { DEV_USER_ID_MIN, isDevUserId } from "@dream/core/telegram/init-data";
import { signDevInitData } from "@/server/auth";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT ONLY. Issues a signed initData for opening the Mini App in a
 * regular browser. Disabled unless ALLOW_DEV_AUTH=true (the env loader refuses
 * that flag in production). Identities are restricted to a reserved id range
 * and signed with a dev-only secret, so they can't impersonate real users.
 */
export async function GET(req: NextRequest) {
  if (!devAuthEnabled()) return json({ error: { code: "not_found" } }, 404);
  const id = Number(req.nextUrl.searchParams.get("id") ?? String(DEV_USER_ID_MIN + 1));
  const name = (req.nextUrl.searchParams.get("name") ?? "Dev").slice(0, 32);
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ru";
  if (!Number.isSafeInteger(id) || !isDevUserId(id)) return json({ error: { code: "validation_failed", message: `id must be >= ${DEV_USER_ID_MIN}` } }, 400);
  const initData = signDevInitData({
    user: { id, first_name: name, username: `dev_${id}`, language_code: lang },
    startParam: req.nextUrl.searchParams.get("start") ?? undefined,
  });
  return json({ initData, dev: true });
}
