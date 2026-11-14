import type { NextRequest } from "next/server";
import { cancelJob } from "@dream/core/services/generation";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  return json(await cancelJob(user, UuidParam.parse(params.id)));
});
