"use server";

import { redirect } from "next/navigation";
import { audit } from "@dream/core/services/admin-auth";
import { endAdminSession, readAdminSession, requestIp } from "@/server/admin/session";

export async function logoutAction(): Promise<void> {
  const session = await readAdminSession();
  await endAdminSession();
  if (session) await audit(session.telegramId, "admin.logout", undefined, undefined, await requestIp()).catch(() => undefined);
  redirect("/admin/login");
}
