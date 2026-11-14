"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Gift, Globe, LifeBuoy, Receipt, Shield, ShieldCheck, Sparkles, Ticket, Wallet } from "lucide-react";
import type { ProfileDto } from "@dream/core/dto";
import { Avatar } from "@/components/profile/avatar";
import { MenuGroup, MenuItem } from "@/components/profile/menu";
import { useMe, useSession } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { Badge, Segmented } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import { TextInput } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useLocale, useT } from "@/i18n";
import type { Locale } from "@/i18n";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queries";
import { openTelegramLink } from "@/lib/telegram";

export default function ProfilePage() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  const me = useMe();
  const { devIdentity } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [promoOpen, setPromoOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || t.profile.defaultName;

  async function changeLanguage(l: Locale) {
    const prev = locale;
    setLocale(l);
    try {
      const updated = await api<ProfileDto>("/api/profile", { method: "PATCH", body: { language: l } });
      qc.setQueryData(qk.profile, updated);
      // Styles, products and other server-localized data must be refetched in the new language.
      void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "session" && JSON.stringify(query.queryKey) !== JSON.stringify(qk.profile) });
    } catch (err) {
      setLocale(prev);
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="min-h-app pb-nav">
      <header className="safe-top px-5">
        <div className="flex items-center gap-4 pt-3">
          <Avatar src={me.photoUrl} name={name} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[30px] leading-[1.05] font-medium text-fg">{name}</h1>
            {me.username ? <p className="truncate text-[14px] text-fg-muted">@{me.username}</p> : null}
            <p className="mt-0.5 text-[12.5px] text-fg-dim">
              {t.profile.since(formatDate(me.createdAt, locale))} · {t.profile.dreams(me.dreamsCount)}
            </p>
          </div>
        </div>
        {devIdentity ? (
          <div className="mt-3">
            <Badge tone="demo">{t.app.devIdentity}</Badge>
          </div>
        ) : null}
      </header>

      <section className="mt-6 px-5">
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(150deg,rgb(174_156_251/0.16),rgb(14_16_30/0.6)_55%,rgb(114_193_209/0.08))] p-5">
          <div className="decor-anim pointer-events-none absolute -top-16 -right-10 size-48 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(246_214_144/0.22),transparent)]" aria-hidden />
          <p className="text-[12px] font-semibold tracking-[0.16em] text-fg-dim uppercase">{t.profile.balanceTitle}</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-[56px] leading-none font-medium text-fg tabular-nums">{me.balance}</span>
            <span className="text-[15px] text-fg-muted">{t.profile.balanceUnit(me.balance)}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {me.reserved > 0 ? <Badge>{t.profile.reserved(me.reserved)}</Badge> : null}
            {me.freeSlideshowsLeft > 0 ? <Badge tone="mint">{t.profile.freeLeft(me.freeSlideshowsLeft)}</Badge> : null}
          </div>
          <Button asChild variant="gold" size="lg" block className="mt-5">
            <Link href="/profile/balance">
              <Sparkles />
              {t.profile.buy}
            </Link>
          </Button>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 px-5">
        <MenuGroup>
          <MenuItem icon={<Wallet />} label={t.profile.menu.balance} value={t.common.creditsShort(me.balance)} href="/profile/balance" />
          <MenuItem icon={<Receipt />} label={t.profile.menu.history} href="/profile/payments" />
          <MenuItem icon={<Gift />} label={t.profile.menu.invite} hint={t.profile.menu.inviteHint} href="/profile/invite" />
          <MenuItem icon={<Ticket />} label={t.profile.menu.promo} onClick={() => setPromoOpen(true)} />
        </MenuGroup>

        <MenuGroup>
          <MenuItem
            icon={<Globe />}
            label={t.profile.menu.language}
            trailing={
              <Segmented
                size="sm"
                className="w-[150px]"
                label={t.profile.menu.language}
                value={locale}
                onChange={(v) => void changeLanguage(v)}
                options={[
                  { value: "ru", label: "RU" },
                  { value: "en", label: "EN" },
                ]}
              />
            }
          />
          <MenuItem icon={<Bell />} label={t.profile.menu.notifications} href="/profile/settings" />
          <MenuItem icon={<Shield />} label={t.profile.menu.privacy} href="/profile/privacy" />
          <MenuItem icon={<LifeBuoy />} label={t.profile.menu.support} onClick={() => setSupportOpen(true)} />
        </MenuGroup>

        {me.isAdmin ? (
          <MenuGroup>
            <MenuItem icon={<ShieldCheck />} label={t.profile.menu.admin} href="/admin/login" external />
          </MenuGroup>
        ) : null}
      </section>

      <PromoSheet open={promoOpen} onOpenChange={setPromoOpen} />

      <Sheet open={supportOpen} onOpenChange={setSupportOpen} title={t.profile.supportTitle} description={t.profile.supportText}>
        {me.botUsername ? (
          <Button size="lg" block onClick={() => openTelegramLink(`https://t.me/${me.botUsername}?start=support`)}>
            <LifeBuoy />
            {t.profile.openSupport}
          </Button>
        ) : (
          <p className="text-[14px] text-fg-muted">{t.profile.supportText}</p>
        )}
      </Sheet>
    </div>
  );
}

function PromoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      const res = await api<{ credits: number; balance: number }>("/api/profile/promo", { method: "POST", body: { code } });
      toast.success(t.profile.promoSuccess(res.credits));
      void qc.invalidateQueries({ queryKey: qk.profile });
      void qc.invalidateQueries({ queryKey: qk.transactions });
      setCode("");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.profile.promoTitle}
      footer={
        <Button size="lg" block disabled={code.trim().length < 3} loading={busy} onClick={apply}>
          {t.profile.promoApply}
        </Button>
      }
    >
      <TextInput
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32))}
        placeholder={t.profile.promoPlaceholder}
        aria-label={t.profile.promoTitle}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="text-center tracking-[0.2em] uppercase"
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.trim().length >= 3) void apply();
        }}
      />
    </Sheet>
  );
}
