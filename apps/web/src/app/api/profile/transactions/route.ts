import type { NextRequest } from "next/server";
import type { CreditTxDto } from "@dream/core/dto";
import { listCreditTransactions } from "@dream/core/services/credits";
import { authenticate } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const { user } = await authenticate(req);
  const rows = await listCreditTransactions(user.id, 100);
  // Capture entries move reserved credits only (amount 0) — hide them from the user-facing history.
  const out: CreditTxDto[] = rows
    .filter((r) => r.type !== "capture")
    .map((r) => ({ id: r.id, amount: r.amount, type: r.type, createdAt: r.createdAt.toISOString(), note: r.type === "admin_grant" || r.type === "admin_revoke" ? r.note : null }));
  return json(out);
});
