import type { NextRequest } from "next/server";
import { z } from "zod";
import { track } from "@dream/core/services/analytics";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";
import { sendMediaToChat } from "@/server/telegram-media";

export const dynamic = "force-dynamic";

export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 10 });
  const { mediaId } = await readJson(req, z.object({ mediaId: z.string().uuid() }));
  await sendMediaToChat(user, UuidParam.parse(params.id), mediaId);
  await track("result_downloaded", user.id, { via: "chat" });
  return json({ ok: true });
});
