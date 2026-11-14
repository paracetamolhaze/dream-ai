import type { NextRequest } from "next/server";
import { listUserPayments } from "@dream/core/services/payments";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  return json(await listUserPayments(user.id, userLocale(user)));
});
