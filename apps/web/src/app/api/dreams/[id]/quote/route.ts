import type { NextRequest } from "next/server";
import { getQuote } from "@dream/core/services/generation";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  return json(await getQuote(user, UuidParam.parse(params.id), userLocale(user)));
});
