import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteDream, getDreamDetail, renameDream, setFavorite, setPublicationConsent, updateDreamText } from "@dream/core/services/dreams";
import { authenticate } from "@/server/auth";
import { handler, json, readJson } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

export const GET = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  return json(await getDreamDetail(user, UuidParam.parse(params.id)));
});

const Patch = z.object({
  title: z.string().min(1).max(120).optional(),
  editedText: z.string().min(1).max(20_000).optional(),
  isFavorite: z.boolean().optional(),
  publicationConsent: z.boolean().optional(),
});

export const PATCH = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  const id = UuidParam.parse(params.id);
  const body = await readJson(req, Patch);
  if (body.editedText !== undefined) await updateDreamText(user, id, body.editedText);
  if (body.title !== undefined) await renameDream(user, id, body.title);
  if (body.isFavorite !== undefined) await setFavorite(user, id, body.isFavorite);
  if (body.publicationConsent !== undefined) await setPublicationConsent(user, id, body.publicationConsent);
  return json(await getDreamDetail(user, id));
});

export const DELETE = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  await deleteDream(user, UuidParam.parse(params.id));
  return new Response(null, { status: 204 });
});
