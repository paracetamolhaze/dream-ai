import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@dream/core/db/client";
import { generationJobs } from "@dream/core/db/schema";
import { getPaymentStatus } from "@dream/core/services/payments";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";
import { UuidParam } from "@/server/schemas";

export const dynamic = "force-dynamic";

/** Payment status polling after `openInvoice` reports "paid". jobId is set once the intent's generation started. */
export const GET = handler<{ id: string }>(async (req: NextRequest, { params }) => {
  const { user } = await authenticate(req);
  const id = UuidParam.parse(params.id);
  const p = await getPaymentStatus(user, id);
  let jobId: string | null = null;
  if (p.status === "paid" && p.intent) {
    const [job] = await getDb()
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(and(eq(generationJobs.userId, user.id), eq(generationJobs.idempotencyKey, p.intent.idempotencyKey)))
      .orderBy(desc(generationJobs.createdAt))
      .limit(1);
    jobId = job?.id ?? null;
  }
  return json({ status: p.status, jobId });
});
