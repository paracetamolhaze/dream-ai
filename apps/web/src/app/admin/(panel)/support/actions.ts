"use server";

import { z } from "zod";
import { closeTicket } from "@dream/core/services/admin-ops";
import { replyToTicket } from "@dream/core/services/support";
import { adminAction, zText, zUuid } from "@/server/admin/action";

export const replyTicketAction = adminAction({
  name: "support.reply",
  role: "support",
  revalidate: ["/admin/support"],
  schema: z.object({ ticketId: zUuid, reply: zText(3500, 2) }),
  async run(input, admin) {
    await replyToTicket(input.ticketId, input.reply, admin.telegramId);
    return { message: "Ответ отправлен пользователю в Telegram", target: { type: "ticket", id: input.ticketId }, payload: { length: input.reply.length } };
  },
});

export const closeTicketAction = adminAction({
  name: "support.close",
  role: "support",
  revalidate: ["/admin/support"],
  schema: z.object({ ticketId: zUuid }),
  async run(input) {
    await closeTicket(input.ticketId);
    return { message: "Обращение закрыто", target: { type: "ticket", id: input.ticketId } };
  },
});
