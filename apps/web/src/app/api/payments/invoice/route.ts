import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@dream/core/errors";
import { hasBotToken } from "@dream/core/telegram/bot-api";
import { createInvoice } from "@dream/core/services/payments";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { StartGenerationSchema } from "@/server/schemas";

export const dynamic = "force-dynamic";

const Body = z.object({
  productId: z.string().min(1).max(64),
  intent: z.object({ dreamId: z.string().uuid(), body: StartGenerationSchema }).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req, { rateLimit: 30 });
  if (!hasBotToken()) throw new AppError("provider_unavailable", "Payments require TELEGRAM_BOT_TOKEN");
  const body = await readJson(req, Body);
  return json(await createInvoice(user, body.productId, body.intent));
});
