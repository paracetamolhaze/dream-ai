"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import type { InvoiceDto, ProductDto, StartGenerationBody, StartGenerationResponse } from "@dream/core/dto";
import { useMe } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { Badge, Spinner } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { api } from "@/lib/api";
import { rememberJobOptions } from "@/lib/generation";
import { qk, useProducts } from "@/lib/queries";
import { canPayInTelegram, haptic, openInvoice } from "@/lib/telegram";
import { cn, sleep } from "@/lib/utils";

type Phase = "list" | "opening" | "confirming" | "success" | "pending";

export interface PurchaseIntent {
  dreamId: string;
  body: StartGenerationBody;
}

/**
 * Telegram Stars checkout. With an `intent` the generation starts on the
 * server right after the confirmed payment; we wait for the job id.
 * Credits are granted only by the server-confirmed successful_payment.
 */
export function PurchaseSheet({ open, onOpenChange, need, intent, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; need?: number; intent?: PurchaseIntent; onDone: (r: { jobId: string | null }) => void }) {
  const t = useT();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      title={need ? t.purchase.titleNeed : t.purchase.titleStore}
      description={need ? t.purchase.needMore(need, me.balance) : t.purchase.starsNote}
    >
      {open ? <PurchaseFlow need={need} intent={intent} onDone={onDone} onBusyChange={setBusy} /> : null}
    </Sheet>
  );
}

/** Product list + Stars checkout state machine (used in the sheet and inline on the balance page). */
export function PurchaseFlow({ need, intent, onDone, onBusyChange }: { need?: number; intent?: PurchaseIntent; onDone: (r: { jobId: string | null }) => void; onBusyChange?: (busy: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const qc = useQueryClient();
  const products = useProducts();
  const [phase, setPhase] = useState<Phase>("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [credited, setCredited] = useState(0);
  const deficit = need ? Math.max(0, need - me.balance) : 0;
  const canPay = canPayInTelegram();


  const { singles, packs } = useMemo(() => {
    const list = products.data ?? [];
    const singles = list.filter((p) => p.kind !== "credit_pack").sort((a, b) => Number(b.credits >= deficit) - Number(a.credits >= deficit) || a.stars - b.stars);
    const packs = list.filter((p) => p.kind === "credit_pack");
    return { singles: deficit > 0 ? singles.filter((p) => p.credits >= deficit) : singles, packs };
  }, [products.data, deficit]);

  function finish(jobId: string | null, credits: number) {
    haptic.notify("success");
    setCredited(credits);
    setPhase("success");
    void qc.invalidateQueries({ queryKey: qk.profile });
    void qc.invalidateQueries({ queryKey: qk.payments });
    void qc.invalidateQueries({ queryKey: qk.transactions });
    if (intent) void qc.invalidateQueries({ queryKey: qk.dream(intent.dreamId) });
    setTimeout(() => {
      onDone({ jobId });
      setPhase("list");
      setSelected(null);
    }, 1200);
  }

  async function waitForPayment(paymentId: string, product: ProductDto) {
    const started = Date.now();
    let fallbackTried = false;
    while (Date.now() - started < 60_000) {
      const st = await api<{ status: string; jobId: string | null }>(`/api/payments/${paymentId}`).catch(() => null);
      if (st?.status === "paid") {
        if (!intent) return finish(null, product.credits);
        if (st.jobId) {
          rememberJobOptions(st.jobId, intent.body);
          return finish(st.jobId, product.credits);
        }
        // Credits arrived but the auto-start hasn't reported a job yet: start it ourselves
        // with the same idempotency key (returns the same job if it already exists).
        if (!fallbackTried && Date.now() - started > 8000) {
          fallbackTried = true;
          try {
            const res = await api<StartGenerationResponse>(`/api/dreams/${intent.dreamId}/generate`, { method: "POST", body: intent.body });
            rememberJobOptions(res.job.id, intent.body);
            return finish(res.job.id, product.credits);
          } catch {
            /* keep polling */
          }
        }
      } else if (st && (st.status === "failed" || st.status === "expired")) {
        toast.error(t.purchase.failed);
        setPhase("list");
        return;
      }
      await sleep(1500);
    }
    setPhase("pending");
  }

  async function buy(product: ProductDto) {
    if (!canPay) {
      toast.toast({ title: t.purchase.onlyInTelegram });
      return;
    }
    setSelected(product.id);
    setPhase("opening");
    try {
      const inv = await api<InvoiceDto>("/api/payments/invoice", { method: "POST", body: { productId: product.id, intent } });
      trackEvent("checkout_started", { product: product.id, stars: product.stars, withIntent: Boolean(intent) });
      const status = await openInvoice(inv.invoiceUrl);
      if (status === "paid" || status === "pending") {
        setPhase("confirming");
        await waitForPayment(inv.paymentId, product);
      } else {
        if (status === "failed") toast.error(t.purchase.failed);
        setPhase("list");
      }
    } catch (err) {
      toast.error(errorMessage(err));
      setPhase("list");
    }
  }

  const busy = phase === "opening" || phase === "confirming" || phase === "success";
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "confirming" || phase === "opening" ? (
          <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-10 text-center">
            <Spinner className="size-9" />
            <p className="mt-4 text-[16px] font-semibold">{phase === "opening" ? t.purchase.paying : t.purchase.confirming}</p>
            {phase === "confirming" ? <p className="mt-1 text-[14px] text-fg-muted">{intent ? t.purchase.startingGeneration : t.purchase.confirmingText}</p> : null}
          </motion.div>
        ) : phase === "success" ? (
          <motion.div key="ok" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-10 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-mint-400/15 text-mint-300">
              <Check className="size-8" />
            </div>
            <p className="mt-4 font-display text-[26px]">{t.purchase.successTitle}</p>
            <p className="mt-1 text-[14px] text-fg-muted">{intent ? t.purchase.startingGeneration : t.purchase.successText(credited)}</p>
          </motion.div>
        ) : phase === "pending" ? (
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-5 py-8 text-center">
            <p className="max-w-[300px] text-[15px] leading-relaxed text-fg-muted">{t.purchase.pendingNote}</p>
            <Button variant="secondary" onClick={() => onDone({ jobId: null })}>
              {t.common.done}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-6">
            {!canPay ? <p className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-[14px] leading-relaxed text-amber-300">{t.purchase.onlyInTelegram}</p> : null}
            {products.isLoading ? (
              <div className="grid gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-[76px] rounded-[20px]" />
                ))}
              </div>
            ) : products.isError ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-[14px] leading-relaxed text-fg-muted">{t.common.loadFailed}</p>
                <Button variant="secondary" size="sm" onClick={() => void products.refetch()}>
                  {t.common.retry}
                </Button>
              </div>
            ) : singles.length + packs.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-fg-muted">{t.purchase.empty}</p>
            ) : (
              <>
                {singles.length > 0 && need ? (
                  <ProductGroup title={t.purchase.singles} items={singles} onBuy={buy} selected={selected} deficit={deficit} disabled={busy} />
                ) : null}
                {packs.length > 0 ? <ProductGroup title={t.purchase.packs} items={packs} onBuy={buy} selected={selected} deficit={deficit} disabled={busy} /> : null}
                {singles.length > 0 && !need ? <ProductGroup title={t.purchase.singles} items={singles} onBuy={buy} selected={selected} deficit={0} disabled={busy} /> : null}
              </>
            )}
            <p className="text-center text-[12px] leading-relaxed text-fg-dim">{t.purchase.starsNote}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ProductGroup({ title, items, onBuy, selected, deficit, disabled }: { title: string; items: ProductDto[]; onBuy: (p: ProductDto) => void; selected: string | null; deficit: number; disabled: boolean }) {
  const t = useT();
  return (
    <section>
      <h3 className="mb-2.5 text-[12px] font-semibold tracking-[0.14em] text-fg-dim uppercase">{title}</h3>
      <ul className="grid gap-2.5">
        {items.map((p) => {
          const fits = deficit > 0 && p.credits >= deficit;
          const badge = p.badge ? t.purchase.badges[p.badge] : null;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onBuy(p)}
                className={cn(
                  "flex w-full items-center gap-3.5 rounded-[20px] border px-4 py-3.5 text-left transition-colors active:scale-[0.99] disabled:opacity-60",
                  fits ? "border-lilac-300/30 bg-lilac-400/[0.08]" : "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05]",
                  selected === p.id && "border-lilac-300/50",
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[radial-gradient(circle_at_35%_30%,rgb(246_214_144/0.35),rgb(246_214_144/0.05))] text-gold-300">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-fg">{p.title}</span>
                    {fits ? <Badge tone="lilac">{t.purchase.fits}</Badge> : badge ? <Badge tone="gold">{badge}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-muted">{t.purchase.perItem(p.credits)}</span>
                </span>
                <span className="btn-gold inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] font-bold">{t.common.stars(p.stars)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
