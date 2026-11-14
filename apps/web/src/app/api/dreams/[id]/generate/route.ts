import type { NextRequest } from "next/server";
import { startGeneration } from "@dream/core/services/generation";
import { userLocale } from "@dream/core/services/users";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { StartGenerationSchema, UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  const body = await readJson(req, StartGenerationSchema);
  const job = await startGeneration(user, UuidParam.parse(params.id), { ...body, kind: "full", locale: userLocale(user) });
  return json({ job }, 201);
});
