"use server";

import { z } from "zod";
import { refundPayment } from "@dream/core/services/payments";
import { adminAction, zText, zUuid } from "@/server/admin/action";

export const refundPaymentAction = adminAction({
  name: "payment.refund",
  schema: z.object({ paymentId: zUuid, reason: zText(300, 3) }),
  revalidate: ["/admin/payments", "/admin"],
  async run(input, admin) {
    const { revokedCredits } = await refundPayment(input.paymentId, admin.telegramId, input.reason);
    return {
      message: `Возврат Stars выполнен. Списано кредитов: ${revokedCredits}.`,
      target: { type: "payment", id: input.paymentId },
      payload: { reason: input.reason, revokedCredits },
    };
  },
});
