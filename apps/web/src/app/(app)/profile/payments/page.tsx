"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState } from "@/components/app/states";
import { Badge, Segmented } from "@/components/ui/controls";
import { useErrorMessage, useLocale, useT } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { usePayments, useTransactions } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function PaymentsPage() {
  const t = useT();
  const [locale] = useLocale();
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<"payments" | "credits">("payments");
  const payments = usePayments();
  const tx = useTransactions();

  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+28px)]">
      <PageHeader backHref="/profile" title={t.history.title} large />
      <div className="mt-5 px-5">
        <Segmented
          label={t.history.title}
          value={tab}
          onChange={setTab}
          options={[
            { value: "payments", label: t.history.payments },
            { value: "credits", label: t.history.credits },
          ]}
        />
      </div>

      <section className="mt-4 px-5">
        {tab === "payments" ? (
          payments.isError ? (
            <ErrorState title={t.app.errorTitle} text={errorMessage(payments.error)} onRetry={() => void payments.refetch()} retryLabel={t.common.tryAgain} />
          ) : payments.isLoading ? (
            <ListSkeleton />
          ) : !payments.data?.length ? (
            <EmptyState icon={<Receipt className="size-7" strokeWidth={1.5} />} title={t.history.emptyPayments} />
          ) : (
            <ul className="glass divide-y divide-white/[0.05] overflow-hidden rounded-[24px]">
              {payments.data.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-fg">{p.productTitle ?? "—"}</p>
                    <p className="text-[12.5px] text-fg-dim">
                      {formatDateTime(p.paidAt ?? p.createdAt, locale)} · {t.common.creditsShort(p.credits)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[15px] font-semibold text-fg tabular-nums">{t.common.stars(p.stars)}</span>
                    <Badge tone={p.status === "paid" ? "mint" : p.status === "refunded" ? "gold" : p.status === "pending" ? "default" : "rose"}>{t.history.status[p.status] ?? p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : tx.isError ? (
          <ErrorState title={t.app.errorTitle} text={errorMessage(tx.error)} onRetry={() => void tx.refetch()} retryLabel={t.common.tryAgain} />
        ) : tx.isLoading ? (
          <ListSkeleton />
        ) : !tx.data?.length ? (
          <EmptyState icon={<Receipt className="size-7" strokeWidth={1.5} />} title={t.history.emptyCredits} />
        ) : (
          <ul className="glass divide-y divide-white/[0.05] overflow-hidden rounded-[24px]">
            {tx.data.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-fg">{t.history.tx[x.type] ?? x.type}</p>
                  <p className="text-[12.5px] text-fg-dim">{formatDateTime(x.createdAt, locale)}</p>
                </div>
                <span className={cn("text-[15px] font-semibold tabular-nums", x.amount > 0 ? "text-mint-300" : x.amount < 0 ? "text-fg" : "text-fg-dim")}>
                  {x.amount > 0 ? `+${x.amount}` : x.amount === 0 ? "·" : x.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-[64px] rounded-[20px]" />
      ))}
    </div>
  );
}
