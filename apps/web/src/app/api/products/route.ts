import type { NextRequest } from "next/server";
import { listActiveProducts, productDto } from "@dream/core/services/pricing";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  const locale = userLocale(user);
  return json((await listActiveProducts()).map((p) => productDto(p, locale)));
});
