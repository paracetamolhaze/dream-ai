import type { NextRequest } from "next/server";
import { z } from "zod";
import { CLIENT_EVENTS, track } from "@dream/core/services/analytics";
import { authenticate } from "@/server/auth";
import { handler, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(CLIENT_EVENTS),
        props: z.record(z.string(), z.union([z.string().max(80), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .max(20),
});

/** First-party product analytics. No dream content, no third-party trackers. */
export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 120 });
  const { events } = await readJson(req, Body);
  for (const e of events) await track(e.name, user.id, e.props ?? {}, { source: "client" });
  return new Response(null, { status: 204 });
});
