import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildProfile } from "@dream/core/services/profile";
import { getUser, updateUserPreferences } from "@dream/core/services/users";
import { requestAccountDeletion } from "@dream/core/services/account";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  return json(await buildProfile(user));
});

const PatchSchema = z.object({
  language: z.enum(["ru", "en"]).optional(),
  notifications: z
    .object({
      generationReady: z.boolean().optional(),
      reminders: z.boolean().optional(),
      reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      product: z.boolean().optional(),
    })
    .optional(),
  timezone: z
    .string()
    .max(64)
    .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/)
    .nullable()
    .optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  const body = await readJson(req, PatchSchema);
  if (body.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone });
    } catch {
      body.timezone = null;
    }
  }
  await updateUserPreferences(user.id, body);
  return json(await buildProfile(await getUser(user.id)));
});

export const DELETE = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  await requestAccountDeletion(user);
  return new Response(null, { status: 204 });
});
