"use server";

import { z } from "zod";
import { addAdmin, removeAdmin } from "@dream/core/services/admin-ops";
import { adminAction, zInt, zOptText } from "@/server/admin/action";

export const addAdminAction = adminAction({
  name: "team.add",
  role: "owner",
  revalidate: ["/admin/team"],
  schema: z.object({ telegramId: zInt(1, Number.MAX_SAFE_INTEGER), role: z.enum(["admin", "support", "owner"]), note: zOptText(200) }),
  async run(input) {
    await addAdmin(input.telegramId, input.role, input.note);
    return { message: `Доступ выдан: ${input.telegramId}`, target: { type: "admin", id: String(input.telegramId) }, payload: { role: input.role } };
  },
});

export const removeAdminAction = adminAction({
  name: "team.remove",
  role: "owner",
  revalidate: ["/admin/team"],
  schema: z.object({ telegramId: zInt(1, Number.MAX_SAFE_INTEGER) }),
  async run(input, admin) {
    await removeAdmin(input.telegramId, admin.telegramId);
    return { message: "Доступ отозван — сессии этого администратора перестали действовать", target: { type: "admin", id: String(input.telegramId) } };
  },
});
