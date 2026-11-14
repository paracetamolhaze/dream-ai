import type { NextRequest } from "next/server";
import { deleteAllAudio } from "@dream/core/services/account";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  return json({ deleted: await deleteAllAudio(user) });
});
