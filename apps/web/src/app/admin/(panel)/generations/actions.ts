"use server";

import { z } from "zod";
import { adminRetryJob } from "@dream/core/services/admin-ops";
import { adminAction, zUuid } from "@/server/admin/action";

export const retryJobAction = adminAction({
  name: "job.retry",
  schema: z.object({ jobId: zUuid }),
  revalidate: ["/admin/generations", "/admin"],
  async run(input, admin) {
    const { jobId } = await adminRetryJob(admin.telegramId, input.jobId);
    return { message: `Запущена новая задача ${jobId.slice(0, 8)} (бесплатно для пользователя)`, target: { type: "job", id: input.jobId }, payload: { newJobId: jobId } };
  },
});
