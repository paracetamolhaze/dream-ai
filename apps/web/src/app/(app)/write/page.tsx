"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Feather } from "lucide-react";
import type { DreamDetailDto } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AutoTextarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { api } from "@/lib/api";
import { MAX_DREAM_TEXT as MAX_TEXT, MIN_DREAM_TEXT as MIN_TEXT } from "@/lib/constants";
import { useSessionState } from "@/lib/hooks";
import { qk } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function WritePage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [text, setText] = useSessionState("dream.writeDraft", "");
  const [busy, setBusy] = useState(false);
  const len = text.trim().length;

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ dream: DreamDetailDto }>("/api/dreams", { method: "POST", body: { text } });
      qc.setQueryData(qk.dream(res.dream.id), res.dream);
      void qc.invalidateQueries({ queryKey: qk.libraryAll });
      setText("");
      router.replace(`/dreams/${res.dream.id}/prepare`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-app flex-col">
      <PageHeader backHref="/" />
      <div className="flex-1 px-5 pt-2">
        <div className="mb-1 inline-flex size-10 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.04] text-lilac-200">
          <Feather className="size-5" strokeWidth={1.6} aria-hidden />
        </div>
        <h1 className="mt-4 font-display text-[38px] leading-[1.05] font-medium text-moon">{t.write.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{t.write.subtitle}</p>
        <div className="mt-6">
          <AutoTextarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
            placeholder={t.write.placeholder}
            minRows={9}
            autoFocus
            maxLength={MAX_TEXT}
            aria-label={t.write.title}
          />
          <div className="mt-2.5 flex items-start justify-between gap-4 px-1 text-[12.5px]">
            <span className={cn("leading-snug", len < MIN_TEXT ? "text-fg-muted" : "text-fg-dim")}>{len < MIN_TEXT ? t.write.minHint(MIN_TEXT - len) : t.write.tip}</span>
            <span className="shrink-0 text-fg-dim tabular-nums">{t.write.counter(text.length, MAX_TEXT)}</span>
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 bg-[linear-gradient(to_top,var(--color-night-950)_60%,transparent)] px-5 pt-6 pb-[calc(var(--app-bottom)+16px)]">
        <Button size="lg" block disabled={len < MIN_TEXT} loading={busy} onClick={submit} haptics="medium">
          {t.write.submit}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
