import type { NextRequest } from "next/server";
import { z } from "zod";
import { createTextDream, getDreamDetail } from "@dream/core/services/dreams";
import { listLibrary } from "@dream/core/services/library";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

const ListQuery = z.object({
  tab: z.enum(["all", "slideshow", "video"]).default("all"),
  sort: z.enum(["new", "old"]).default("new"),
  favorites: z.enum(["0", "1"]).optional(),
  status: z.enum(["ready", "processing"]).optional(),
  q: z.string().max(500).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  const q = ListQuery.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return json(await listLibrary(user.id, { ...q, favorites: q.favorites === "1" }));
});

/** Typed dream — the user wrote it themselves, so analysis starts immediately. */
export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  const { text } = await readJson(req, z.object({ text: z.string().min(1).max(20_000) }));
  const dream = await createTextDream(user, text, { source: "miniapp_text", confirm: true });
  return json({ dream: await getDreamDetail(user, dream.id) }, 201);
});
