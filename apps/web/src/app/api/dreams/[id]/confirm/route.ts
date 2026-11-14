import type { NextRequest } from "next/server";
import { z } from "zod";
import { confirmDream, getDreamDetail } from "@dream/core/services/dreams";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  const id = UuidParam.parse(params.id);
  const { text } = await readJson(req, z.object({ text: z.string().min(1).max(20_000).optional() }));
  await confirmDream(user, id, text);
  return json({ dream: await getDreamDetail(user, id) });
});
