import type { NextRequest } from "next/server";
import { z } from "zod";
import { getOwnedDream } from "@dream/core/services/dreams";
import { createShareLink, listShareLinks } from "@dream/core/services/share";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  const id = UuidParam.parse(params.id);
  await getOwnedDream(user.id, id);
  return json(await listShareLinks(user, id));
});

const Body = z.object({ mediaId: z.string().uuid(), showTitle: z.boolean().default(true), showText: z.boolean().default(false) });

/** Creates (or updates) a share link — only on an explicit user action. */
export const POST = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  const body = await readJson(req, Body);
  return json(await createShareLink(user, UuidParam.parse(params.id), body.mediaId, { showTitle: body.showTitle, showText: body.showText }), 201);
});
