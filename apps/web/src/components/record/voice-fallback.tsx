"use client";

import { useState } from "react";
import { MessageCircle, PenLine, RotateCcw } from "lucide-react";
import { useMe } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { api } from "@/lib/api";
import { closeApp, isInTelegram, openTelegramLink } from "@/lib/telegram";

export type FallbackReason = "denied" | "unsupported" | "no-device" | "failed";

/**
 * Real fallback when in-app recording is impossible: the bot asks the user for
 * a voice message in the chat (same pipeline, same library), then the Mini App closes.
 */
export function VoiceFallbackSheet({ reason, onOpenChange, onRetry, onWriteInstead }: { reason: FallbackReason | null; onOpenChange: (open: boolean) => void; onRetry?: () => void; onWriteInstead?: () => void }) {
  const t = useT();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const inTelegram = isInTelegram();

  const title =
    reason === "denied" ? t.home.micDeniedTitle : reason === "unsupported" ? t.home.unsupportedTitle : reason === "no-device" ? t.home.noDeviceTitle : t.home.failedTitle;
  const text = reason === "denied" ? t.home.micDeniedText : reason === "unsupported" ? t.home.unsupportedText : reason === "no-device" ? t.home.noDeviceText : t.home.failedText;

  async function recordInChat() {
    if (!inTelegram) {
      if (me.botUsername) openTelegramLink(`https://t.me/${me.botUsername}`);
      return;
    }
    setBusy(true);
    try {
      await api("/api/bot/voice-fallback", { method: "POST", body: {} });
      toast.success(t.home.fallbackSent);
      setTimeout(() => closeApp(), 900);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={reason !== null}
      onOpenChange={onOpenChange}
      title={title}
      description={text}
      footer={
        <div className="flex flex-col gap-2.5">
          {inTelegram || me.botUsername ? (
            <Button size="lg" block loading={busy} onClick={recordInChat}>
              <MessageCircle />
              {inTelegram ? t.home.fallbackButton : t.home.openBot}
            </Button>
          ) : null}
          <div className="flex gap-2.5">
            {onRetry && reason !== "unsupported" ? (
              <Button variant="secondary" block onClick={onRetry}>
                <RotateCcw />
                {t.common.tryAgain}
              </Button>
            ) : null}
            {onWriteInstead ? (
              <Button variant="secondary" block onClick={onWriteInstead}>
                <PenLine />
                {t.home.writeInstead}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {!inTelegram ? <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[14px] leading-relaxed text-fg-muted">{t.home.fallbackOutside}</p> : <div className="h-1" />}
    </Sheet>
  );
}
