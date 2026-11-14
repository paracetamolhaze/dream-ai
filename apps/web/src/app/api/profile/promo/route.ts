import type { NextRequest } from "next/server";
import { z } from "zod";
import { redeemPromo } from "@dream/core/services/promo";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  const { code } = await readJson(req, z.object({ code: z.string().min(1).max(64) }));
  return json(await redeemPromo(user, code));
});
