"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hitRateLimit } from "@dream/core/redis";
import { audit, consumeAdminLoginToken } from "@dream/core/services/admin-auth";
import type { ActionState } from "../../_lib/types";
import { requestIp, startAdminSession } from "@/server/admin/session";

/**
 * Magic-link sign-in. The link from the bot opens a confirmation page; the
 * one-time token is consumed only on this POST, so link-preview crawlers that
 * GET the URL cannot burn it.
 */
export async function loginWithToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ip = (await requestIp()) ?? "unknown";
  const rl = await hitRateLimit(`admin-login:${ip}`, 20, 600);
  if (!rl.allowed) return { ok: false, message: "Слишком много попыток входа. Подождите 10 минут.", at: Date.now() };
  const parsed = z.string().min(20).max(300).safeParse(formData.get("token"));
  if (!parsed.success) return { ok: false, message: "Ссылка повреждена.", at: Date.now() };
  const telegramId = await consumeAdminLoginToken(parsed.data);
  if (!telegramId) return { ok: false, message: "Ссылка недействительна, уже использована или устарела. Отправьте /admin боту ещё раз.", at: Date.now() };
  await startAdminSession(telegramId);
  await audit(telegramId, "admin.login", undefined, { method: "magic_link" }, ip).catch(() => undefined);
  redirect("/admin");
}
