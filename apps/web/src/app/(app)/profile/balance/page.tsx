"use client";

import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { useMe } from "@/components/providers/session";
import { PurchaseFlow } from "@/components/purchase/purchase-sheet";
import { Badge } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";

export default function BalancePage() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+28px)]">
      <PageHeader backHref="/profile" title={t.purchase.titleStore} large />
      <section className="mt-5 px-5">
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(150deg,rgb(246_214_144/0.12),rgb(14_16_30/0.65)_55%,rgb(174_156_251/0.1))] p-5">
          <div className="decor-anim pointer-events-none absolute -top-14 -right-12 size-44 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(246_214_144/0.25),transparent)]" aria-hidden />
          <p className="text-[12px] font-semibold tracking-[0.16em] text-fg-dim uppercase">{t.profile.balanceTitle}</p>
          <p className="mt-2 flex items-baseline gap-2">
            <Sparkles className="size-6 self-center text-gold-300" aria-hidden />
            <span className="font-display text-[52px] leading-none font-medium text-fg tabular-nums">{me.balance}</span>
            <span className="text-[15px] text-fg-muted">{t.profile.balanceUnit(me.balance)}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {me.reserved > 0 ? <Badge>{t.profile.reserved(me.reserved)}</Badge> : null}
            {me.freeSlideshowsLeft > 0 ? <Badge tone="mint">{t.profile.freeLeft(me.freeSlideshowsLeft)}</Badge> : null}
          </div>
        </div>
      </section>
      <section className="mt-7 px-5">
        <PurchaseFlow onDone={() => toast.success(t.purchase.successTitle)} />
      </section>
    </div>
  );
}
