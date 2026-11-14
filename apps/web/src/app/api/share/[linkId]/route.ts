import type { NextRequest } from "next/server";
import { revokeShareLink } from "@dream/core/services/share";
import { authenticate } from "@/server/auth";
import { handler } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const DELETE = handler<{ linkId: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  await revokeShareLink(user, UuidParam.parse(params.linkId));
  return new Response(null, { status: 204 });
});
