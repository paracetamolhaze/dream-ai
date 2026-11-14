"use client";

import { Copy, Gift, Send } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { useMe } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { openTelegramLink } from "@/lib/telegram";
import { copyToClipboard } from "@/lib/utils";

export default function InvitePage() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  const r = me.referral;
  const whenText = r.trigger === "first_dream" ? t.invite.whenFirstDream : t.invite.whenFirstPurchase;

  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+28px)]">
      <PageHeader backHref="/profile" />
      <section className="px-5 pt-2 text-center">
        <div className="relative mx-auto grid size-28 place-items-center">
          <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(246_214_144/0.3),transparent)]" aria-hidden />
          <div className="relative grid size-20 place-items-center rounded-full border border-gold-300/25 bg-[radial-gradient(circle_at_35%_30%,rgb(255_233_179/0.35),rgb(240_195_95/0.08))] text-gold-200">
            <Gift className="size-9" strokeWidth={1.5} aria-hidden />
          </div>
        </div>
        <h1 className="mt-5 font-display text-[38px] leading-[1.05] font-medium text-moon">{t.invite.title}</h1>
        <p className="mt-2 text-[15px] text-fg-muted">{t.invite.subtitle}</p>
        {r.enabled ? <p className="mx-auto mt-3 max-w-[330px] text-[14px] leading-relaxed text-fg">{t.invite.reward(r.rewardInviter, r.rewardInvited, whenText)}</p> : <p className="mt-3 text-[14px] text-amber-300">{t.invite.disabled}</p>}
      </section>

      <section className="mt-7 px-5">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.14em] text-fg-dim uppercase">{t.invite.yourLink}</p>
        <button
          type="button"
          onClick={async () => {
            if (await copyToClipboard(r.link)) {
              toast.success(t.invite.linkCopied);
              trackEvent("referral_link_copied");
            }
          }}
          className="glass flex w-full items-center gap-3 rounded-[20px] px-4 py-3.5 text-left"
          aria-label={t.common.copy}
        >
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-fg">{r.link.replace(/^https:\/\//, "")}</span>
          <Copy className="size-[18px] shrink-0 text-lilac-300" aria-hidden />
        </button>
        <Button
          size="lg"
          block
          className="mt-3"
          onClick={() => {
            trackEvent("referral_link_copied", { via: "share" });
            openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(t.invite.shareText)}`);
          }}
        >
          <Send />
          {t.invite.share}
        </Button>
      </section>

      <section className="mt-7 grid grid-cols-3 gap-2.5 px-5">
        {(
          [
            ["invited", r.invited],
            ["paying", r.paying],
            ["earned", r.earned],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="glass rounded-[20px] px-3.5 py-3">
            <p className="text-[11.5px] font-medium text-fg-dim">{t.invite.stats[k]}</p>
            <p className="mt-1 font-display text-[28px] leading-none font-medium text-fg tabular-nums">{v}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
