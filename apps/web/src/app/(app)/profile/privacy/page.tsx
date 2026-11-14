"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Portal } from "radix-ui";
import { Lock, MicOff, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { LogoMark } from "@/components/app/logo";
import { useMe } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { api } from "@/lib/api";
import { closeApp } from "@/lib/telegram";

export default function PrivacyPage() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [audioOpen, setAudioOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [goodbye, setGoodbye] = useState(false);
  const days = me.audioRetentionDays;
  const retention = days < 0 ? t.privacy.audioForever : days === 0 ? t.privacy.audioImmediate : t.privacy.audioDays(days);

  async function deleteAudio() {
    try {
      const res = await api<{ deleted: number }>("/api/profile/delete-audio", { method: "POST", body: {} });
      toast.success(t.privacy.deleteAudioDone(res.deleted));
      void qc.invalidateQueries({ queryKey: ["dream"] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function deleteAccount() {
    try {
      await api("/api/profile", { method: "DELETE" });
      setGoodbye(true);
      setTimeout(() => closeApp(), 3500);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+28px)]">
      <PageHeader backHref="/profile" title={t.privacy.title} large />

      <section className="mt-5 px-5">
        <p className="text-[15px] leading-relaxed text-fg">{t.privacy.intro}</p>
        <ul className="mt-5 flex flex-col gap-3">
          {t.privacy.points.map((p, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-fg-muted">
              {i === 0 ? <Lock className="mt-0.5 size-[18px] shrink-0 text-lilac-300" aria-hidden /> : <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-lilac-300" aria-hidden />}
              {p}
            </li>
          ))}
          <li className="flex gap-3 text-[14px] leading-relaxed text-fg-muted">
            <MicOff className="mt-0.5 size-[18px] shrink-0 text-lilac-300" aria-hidden />
            {retention}
          </li>
        </ul>
      </section>

      <section className="mt-8 flex flex-col gap-3 px-5">
        <Button variant="secondary" size="lg" block onClick={() => setAudioOpen(true)}>
          <MicOff />
          {t.privacy.deleteAudio}
        </Button>
        <Button variant="danger" size="lg" block onClick={() => setAccountOpen(true)}>
          <Trash2 />
          {t.privacy.deleteAccount}
        </Button>
      </section>

      <ConfirmDialog
        open={audioOpen}
        onOpenChange={setAudioOpen}
        title={t.privacy.deleteAudioTitle}
        description={t.privacy.deleteAudioText}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        tone="danger"
        onConfirm={deleteAudio}
      />
      <ConfirmDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        title={t.privacy.deleteAccountTitle}
        description={t.privacy.deleteAccountText}
        confirmLabel={t.privacy.deleteAccountButton}
        cancelLabel={t.common.cancel}
        tone="danger"
        requireWord={t.privacy.deleteWord}
        requirePrompt={t.privacy.deletePrompt(t.privacy.deleteWord)}
        onConfirm={deleteAccount}
      />

      <Portal.Root>
        <AnimatePresence>
        {goodbye ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-night-950 px-8 text-center">
            <div className="relative mb-8 grid size-28 place-items-center">
              <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.35),transparent)]" />
              <LogoMark className="relative size-16" />
            </div>
            <h1 className="font-display text-[36px] leading-tight font-medium text-moon">{t.privacy.goodbyeTitle}</h1>
            <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-fg-muted">{t.privacy.goodbyeText}</p>
          </motion.div>
        ) : null}
        </AnimatePresence>
      </Portal.Root>
    </div>
  );
}
