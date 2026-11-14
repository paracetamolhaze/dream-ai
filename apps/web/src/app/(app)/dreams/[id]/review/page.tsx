"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Mic, TriangleAlert } from "lucide-react";
import type { DreamDetailDto } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/states";
import { DreamOrb } from "@/components/dream/orb";
import { AudioPreview } from "@/components/record/audio-preview";
import { RecorderPanel } from "@/components/record/recorder-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import { AutoTextarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { api, isApiError } from "@/lib/api";
import { MAX_DREAM_TEXT, MIN_DREAM_TEXT } from "@/lib/constants";
import { qk, useDream } from "@/lib/queries";
import { safeSession, saveSession } from "@/lib/utils";
import { uploadVoice } from "@/lib/voice";

const ease = [0.22, 1, 0.36, 1] as const;

function readDraft(key: string, base: string): string | null {
  const draft = safeSession<{ base: string; text: string } | null>(key, null);
  return draft && draft.base === base && draft.text !== base ? draft.text : null;
}

export default function ReviewPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}

function Review() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const editMode = search.get("edit") === "1";
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const dreamQ = useDream(id);
  const d = dreamQ.data;
  const draftKey = `dream.review.${id}`;

  // null = untouched → shows the transcript (or unsaved edits restored from this session).
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rerecordOpen, setRerecordOpen] = useState(false);

  // Already confirmed → continue to format choice (unless the user came back to edit).
  useEffect(() => {
    if (!d || editMode) return;
    if (d.status === "analyzing" || d.status === "ready" || d.status === "analysis_failed") router.replace(`/dreams/${id}/prepare`);
  }, [d, editMode, id, router]);

  const base = d ? (d.editedText ?? d.originalText ?? "") : "";
  const draft = edited === null && d ? readDraft(draftKey, base) : null;
  const text = edited ?? draft ?? base;

  function updateText(v: string) {
    const next = v.slice(0, MAX_DREAM_TEXT);
    setEdited(next);
    saveSession(draftKey, { base, text: next });
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await api<{ dream: DreamDetailDto }>(`/api/dreams/${id}/confirm`, { method: "POST", body: { text } });
      qc.setQueryData(qk.dream(id), res.dream);
      saveSession(draftKey, null);
      void qc.invalidateQueries({ queryKey: qk.libraryAll });
      router.replace(`/dreams/${id}/prepare`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  if (dreamQ.isError) {
    const notFound = isApiError(dreamQ.error, "not_found");
    return (
      <div className="min-h-app">
        <PageHeader backHref="/dreams" />
        <ErrorState
          title={notFound ? t.dream.notFoundTitle : t.app.errorTitle}
          text={notFound ? t.dream.notFoundText : errorMessage(dreamQ.error)}
          onRetry={notFound ? undefined : () => void dreamQ.refetch()}
          retryLabel={t.common.tryAgain}
        />
      </div>
    );
  }

  const transcribing = !d || d.status === "transcribing";
  const failed = d?.status === "transcription_failed";
  const len = text.trim().length;

  return (
    <div className="flex min-h-app flex-col">
      <PageHeader backHref="/" />
      <AnimatePresence mode="wait" initial={false}>
        {transcribing ? (
          <motion.section key="listening" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease }} className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
            <DreamOrb variant="listen" />
            <h1 className="mt-8 font-display text-[34px] leading-tight font-medium text-moon">{t.review.listeningTitle}</h1>
            <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-fg-muted">{t.review.listeningText}</p>
          </motion.section>
        ) : (
          <motion.section key="editor" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="flex flex-1 flex-col px-5 pt-2">
            {failed ? (
              <div className="mb-5 flex gap-3 rounded-[22px] border border-rose-400/20 bg-rose-400/[0.07] p-4">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-rose-300" aria-hidden />
                <div>
                  <p className="text-[15px] font-semibold text-fg">{t.review.failedTitle}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{t.review.failedText}</p>
                </div>
              </div>
            ) : null}
            <h1 className="font-display text-[38px] leading-[1.05] font-medium text-moon">{t.review.title}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{t.review.subtitle}</p>
            {d?.transcriptionIsDemo ? (
              <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-3.5">
                <Badge tone="demo">{t.common.demo}</Badge>
                <p className="text-[13.5px] leading-relaxed text-amber-300/90">{t.review.demoNotice}</p>
              </div>
            ) : null}
            {d?.audioUrl ? <AudioPreview className="mt-5" src={d.audioUrl} knownDurationSec={d.audioDurationSec} label={t.review.listen} /> : null}
            {draft !== null ? <p className="mt-4 text-[12.5px] text-lilac-300/80">{t.review.draftRestored}</p> : null}
            <div className="mt-4">
              <AutoTextarea value={text} onChange={(e) => updateText(e.target.value)} placeholder={t.review.placeholder} minRows={8} maxLength={MAX_DREAM_TEXT} aria-label={t.review.title} />
              <div className="mt-2 flex justify-between px-1 text-[12.5px] text-fg-dim">
                <span>{len < MIN_DREAM_TEXT ? t.write.minHint(MIN_DREAM_TEXT - len) : ""}</span>
                <span className="tabular-nums">{t.write.counter(text.length, MAX_DREAM_TEXT)}</span>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {!transcribing ? (
        <div className="sticky bottom-0 mt-6 bg-[linear-gradient(to_top,var(--color-night-950)_62%,transparent)] px-5 pt-6 pb-[calc(var(--app-bottom)+16px)]">
          <div className="flex flex-col gap-2.5">
            <Button size="lg" block disabled={len < MIN_DREAM_TEXT} loading={busy} onClick={confirm} haptics="medium">
              {t.review.confirm}
              <ArrowRight />
            </Button>
            <Button variant="secondary" block onClick={() => setRerecordOpen(true)}>
              <Mic />
              {t.review.rerecord}
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={rerecordOpen} onOpenChange={setRerecordOpen} title={t.review.rerecordTitle} description={t.review.rerecordHint}>
        {rerecordOpen ? (
          <div className="pb-2">
            <RecorderPanel
              variant="compact"
              submitLabel={t.home.send}
              onSubmit={async (rec, onProgress) => {
                const res = await uploadVoice(`/api/dreams/${id}/audio`, rec, onProgress);
                qc.setQueryData(qk.dream(id), res.dream);
                saveSession(draftKey, null);
                setEdited(null);
                setRerecordOpen(false);
              }}
            />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
