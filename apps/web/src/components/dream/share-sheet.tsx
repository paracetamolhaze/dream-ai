"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Link2, Send, Share2, X } from "lucide-react";
import type { DreamDetailDto, MediaDto, ShareLinkDto } from "@dream/core/dto";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useLocale, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { api } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { qk, useShareLinks } from "@/lib/queries";
import { canShareMessage, openTelegramLink, shareMessage } from "@/lib/telegram";
import { copyToClipboard } from "@/lib/utils";

/**
 * "Покажи свой сон друзьям". Nothing becomes public automatically: a link is
 * created only on an explicit action, exposes only this result (title/text per
 * the user's toggles) and can be revoked.
 */
export function ShareSheet({ open, onOpenChange, dream, media, onDownload }: { open: boolean; onOpenChange: (v: boolean) => void; dream: DreamDetailDto; media: MediaDto | null; onDownload: () => void }) {
  const t = useT();
  const [locale] = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const links = useShareLinks(dream.id, open);
  // The switches start from the existing link of this result (so re-sharing never silently
  // widens it); once the user flips a switch, their choice wins.
  const existing = links.data?.find((l) => l.mediaId === media?.id) ?? null;
  const [override, setOverride] = useState<{ showTitle: boolean; showText: boolean } | null>(null);
  const showTitle = override?.showTitle ?? existing?.showTitle ?? true;
  const showText = override?.showText ?? existing?.showText ?? false;
  const [busy, setBusy] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const title = dream.title ?? t.dream.untitled;
  const canSystemShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function ensureLink(): Promise<ShareLinkDto> {
    const link = await api<ShareLinkDto>(`/api/dreams/${dream.id}/share`, { method: "POST", body: { mediaId: media!.id, showTitle, showText } });
    void qc.invalidateQueries({ queryKey: qk.shareLinks(dream.id) });
    return link;
  }

  async function run(kind: string, fn: () => Promise<void>) {
    if (!media) return;
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const shareTelegram = () =>
    run("tg", async () => {
      if (canShareMessage()) {
        const prepared = await api<{ id: string }>(`/api/dreams/${dream.id}/prepared-message`, { method: "POST", body: { mediaId: media!.id, showTitle } });
        const sent = await shareMessage(prepared.id);
        if (sent) {
          toast.success(t.share.sent);
          trackEvent("result_shared", { via: "telegram_message", type: media!.type });
        }
        return;
      }
      const link = await ensureLink();
      openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link.url)}&text=${encodeURIComponent(showTitle ? t.share.shareText(title) : "🌙")}`);
      trackEvent("result_shared", { via: "telegram_link", type: media!.type });
    });

  const copyLink = () =>
    run("copy", async () => {
      const link = await ensureLink();
      const ok = await copyToClipboard(link.url);
      if (ok) {
        toast.success(t.share.linkCopied);
        trackEvent("result_shared", { via: "copy", type: media!.type });
      } else {
        toast.toast({ title: link.url });
      }
    });

  const systemShare = () =>
    run("system", async () => {
      const link = await ensureLink();
      await navigator.share({ title: showTitle ? title : undefined, text: showTitle ? t.share.shareText(title) : undefined, url: link.url });
      trackEvent("result_shared", { via: "system", type: media!.type });
    });

  async function revoke(linkId: string) {
    try {
      await api(`/api/share/${linkId}`, { method: "DELETE" });
      void qc.invalidateQueries({ queryKey: qk.shareLinks(dream.id) });
      toast.success(t.share.revoked);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function setConsent(v: boolean) {
    setConsentBusy(true);
    try {
      const updated = await api<DreamDetailDto>(`/api/dreams/${dream.id}`, { method: "PATCH", body: { publicationConsent: v } });
      qc.setQueryData(qk.dream(dream.id), updated);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setConsentBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.share.title} description={t.share.subtitle}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2.5">
          <Button size="lg" block className="col-span-2" loading={busy === "tg"} disabled={!media} onClick={shareTelegram}>
            <Send />
            {t.share.telegram}
          </Button>
          <Button variant="secondary" block loading={busy === "copy"} disabled={!media} onClick={copyLink}>
            <Link2 />
            {t.share.copyLink}
          </Button>
          <Button variant="secondary" block disabled={!media} onClick={onDownload}>
            <Download />
            {t.share.download}
          </Button>
          {canSystemShare ? (
            <Button variant="secondary" block className="col-span-2" loading={busy === "system"} disabled={!media} onClick={systemShare}>
              <Share2 />
              {t.share.system}
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[22px] border border-white/[0.06] bg-white/[0.025]">
          <label className="flex items-center justify-between gap-4 px-4 py-3.5">
            <span className="text-[14.5px] text-fg">{t.share.showTitle}</span>
            <Switch checked={showTitle} onCheckedChange={(v) => setOverride({ showTitle: v, showText })} label={t.share.showTitle} />
          </label>
          <label className="flex items-center justify-between gap-4 border-t border-white/[0.05] px-4 py-3.5">
            <span className="text-[14.5px] text-fg">{t.share.showText}</span>
            <Switch checked={showText} onCheckedChange={(v) => setOverride({ showTitle, showText: v })} label={t.share.showText} />
          </label>
        </div>

        {links.data && links.data.length > 0 ? (
          <div>
            <h3 className="mb-2 text-[12px] font-semibold tracking-[0.14em] text-fg-dim uppercase">{t.share.activeLinks}</h3>
            <ul className="overflow-hidden rounded-[22px] border border-white/[0.06] bg-white/[0.025]">
              {links.data.map((l, i) => (
                <li key={l.id} className={i > 0 ? "border-t border-white/[0.05]" : undefined}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-fg">{l.url.replace(/^https?:\/\//, "")}</p>
                      <p className="text-[12px] text-fg-dim">
                        {formatShortDate(l.createdAt, locale)} · {t.share.views(l.views)}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void revoke(l.id)} aria-label={t.share.revoke}>
                      <X />
                      {t.share.revoke}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[14.5px] font-semibold text-fg">{t.share.channelTitle}</span>
            <Switch checked={dream.publicationConsent} disabled={consentBusy} onCheckedChange={(v) => void setConsent(v)} label={t.share.channelTitle} />
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">{t.share.channelText}</p>
        </div>
      </div>
    </Sheet>
  );
}
