import type { NextRequest } from "next/server";
import { getJobForUser } from "@dream/core/services/generation";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 400 });
  return json(await getJobForUser(user, UuidParam.parse(params.id)));
});
