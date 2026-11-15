import { env } from "@dream/core/env";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Public, non-secret runtime configuration for the Mini App shell. */
export async function GET() {
  const e = env();
  return json({ appName: e.APP_NAME, botUsername: e.TELEGRAM_BOT_USERNAME ?? null }, { headers: { "cache-control": "public, max-age=300" } });
}
