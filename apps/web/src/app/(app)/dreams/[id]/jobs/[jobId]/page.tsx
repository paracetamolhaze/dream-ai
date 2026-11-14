"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, CircleSlash, RotateCcw, TriangleAlert } from "lucide-react";
import type { JobDto, StartGenerationBody, StartGenerationResponse } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/states";
import { DreamOrb } from "@/components/dream/orb";
import { useMe } from "@/components/providers/session";
import { PurchaseSheet, type PurchaseIntent } from "@/components/purchase/purchase-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, ProgressBar, SectionTitle, Spinner } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { errorText } from "@/i18n/dict";
import { api, isApiError } from "@/lib/api";
import { recallJobOptions, rememberJobOptions } from "@/lib/generation";
import { isJobActive, qk, useDream, useJob } from "@/lib/queries";
import { allowsWriteToPm, canRequestWriteAccess, haptic, requestWriteAccess } from "@/lib/telegram";
import { cn, uuid } from "@/lib/utils";

type StageKey = "analyzing" | "preparing_scenes" | "generating_images" | "generating_video" | "rendering" | "finalizing";
const ALL: StageKey[] = ["analyzing", "preparing_scenes", "generating_images", "generating_video", "rendering", "finalizing"];
const ease = [0.22, 1, 0.36, 1] as const;

function stagesFor(job: JobDto): StageKey[] {
  if (job.kind === "full") return job.mediaType === "video" ? ALL : ALL.filter((s) => s !== "generating_video");
  if (job.kind === "scene_video") return ["generating_images", "generating_video", "rendering", "finalizing"];
  if (job.kind === "scene_image") return ["generating_images", "rendering", "finalizing"];
  return ["rendering", "finalizing"];
}

function currentIndex(job: JobDto, stages: StageKey[]): number {
  if (job.status === "completed") return stages.length;
  if (job.status === "queued") return -1;
  if (job.status === "rendering" && (job.stage === "finalizing" || job.stage === "uploading" || job.progress >= 97)) return stages.indexOf("finalizing");
  const idx = stages.indexOf(job.status as StageKey);
  return idx >= 0 ? idx : 0;
}

export default function JobPage() {
  const { id, jobId } = useParams<{ id: string; jobId: string }>();
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const jobQ = useJob(jobId);
  const dreamQ = useDream(id);
  const job = jobQ.data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [purchase, setPurchase] = useState<{ need: number; intent: PurchaseIntent } | null>(null);
  const [notifyGranted, setNotifyGranted] = useState(false);

  // Finished → refresh caches and glide into the result.
  useEffect(() => {
    if (job?.status !== "completed") return;
    haptic.notify("success");
    void qc.invalidateQueries({ queryKey: qk.dream(id) });
    void qc.invalidateQueries({ queryKey: qk.libraryAll });
    void qc.invalidateQueries({ queryKey: qk.profile });
    const timer = setTimeout(() => router.replace(`/dreams/${id}?view=${job.mediaType}`), 1200);
    return () => clearTimeout(timer);
  }, [job?.status, job?.mediaType, id, qc, router]);

  useEffect(() => {
    if (job?.status === "failed") {
      haptic.notify("error");
      void qc.invalidateQueries({ queryKey: qk.profile });
    }
  }, [job?.status, qc]);

  async function cancel() {
    try {
      const updated = await api<JobDto>(`/api/jobs/${jobId}/cancel`, { method: "POST", body: {} });
      qc.setQueryData(qk.job(jobId), updated);
      void qc.invalidateQueries({ queryKey: qk.profile });
      void qc.invalidateQueries({ queryKey: qk.dream(id) });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function retry() {
    if (!job) return;
    const options = job.kind === "full" ? recallJobOptions(job.id) : null;
    if (!options) {
      router.push(job.kind === "full" ? `/dreams/${id}/prepare?format=${job.mediaType}` : `/dreams/${id}`);
      return;
    }
    const body: StartGenerationBody = { ...options, idempotencyKey: uuid() };
    setRetrying(true);
    try {
      const res = await api<StartGenerationResponse>(`/api/dreams/${id}/generate`, { method: "POST", body });
      rememberJobOptions(res.job.id, body);
      router.replace(`/dreams/${id}/jobs/${res.job.id}`);
    } catch (err) {
      setRetrying(false);
      if (isApiError(err, "insufficient_credits")) {
        setPurchase({ need: job.creditsCost || 1, intent: { dreamId: id, body } });
        return;
      }
      toast.error(errorMessage(err));
    }
  }

  if (jobQ.isError) {
    return (
      <div className="min-h-app">
        <PageHeader backHref={`/dreams/${id}`} />
        <ErrorState title={isApiError(jobQ.error, "not_found") ? t.job.notFound : t.app.errorTitle} text={errorMessage(jobQ.error)} onRetry={() => void jobQ.refetch()} retryLabel={t.common.tryAgain} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-app">
        <PageHeader backHref={`/dreams/${id}`} />
        <div className="flex justify-center pt-32">
          <Spinner className="size-8" />
        </div>
      </div>
    );
  }

  const stages = stagesFor(job);
  const current = currentIndex(job, stages);
  const active = isJobActive(job.status);
  const isVideo = job.mediaType === "video";
  const title = job.kind !== "full" ? t.job.titleScene : isVideo ? t.job.titleVideo : t.job.titleSlideshow;
  const dreamTitle = dreamQ.data?.title ?? t.dream.untitled;
  const showWriteAccess = active && !notifyGranted && !me.botChatAvailable && !allowsWriteToPm() && canRequestWriteAccess();

  return (
    <div className="flex min-h-app flex-col pb-[calc(var(--app-bottom)+24px)]">
      <PageHeader backHref={`/dreams/${id}`} />

      <section className="flex flex-col items-center px-5 pt-2 text-center">
        <AnimatePresence mode="wait" initial={false}>
          {job.status === "completed" ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease }} className="grid size-44 place-items-center">
              <div className="grid size-24 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e6fff4,#78d8b0_55%,#2f7d66)] text-night-950 shadow-[0_20px_60px_-10px_rgb(120_216_176/0.6)]">
                <Check className="size-11" strokeWidth={2.4} />
              </div>
            </motion.div>
          ) : job.status === "failed" || job.status === "cancelled" ? (
            <motion.div key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid size-44 place-items-center">
              <div className={cn("grid size-24 place-items-center rounded-full border", job.status === "failed" ? "border-rose-400/25 bg-rose-400/10 text-rose-300" : "border-white/10 bg-white/[0.05] text-fg-muted")}>
                {job.status === "failed" ? <TriangleAlert className="size-10" strokeWidth={1.6} /> : <CircleSlash className="size-10" strokeWidth={1.6} />}
              </div>
            </motion.div>
          ) : (
            <motion.div key="orb" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <DreamOrb variant="create" />
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-2 line-clamp-1 text-[13px] font-semibold tracking-[0.12em] text-lilac-300/80 uppercase">{dreamTitle}</p>
        <h1 className="mt-2 font-display text-[36px] leading-[1.05] font-medium text-moon">
          {job.status === "completed" ? t.job.completed : job.status === "failed" ? t.job.failedTitle : job.status === "cancelled" ? t.job.cancelledTitle : title}
        </h1>
        {job.isDemo ? (
          <div className="mt-3">
            <Badge tone="demo">{t.job.demoNote}</Badge>
          </div>
        ) : null}
      </section>

      {active || job.status === "completed" ? (
        <section className="mt-7 px-5">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="text-fg-muted">{job.status === "queued" ? t.job.queued : t.job.stages[stages[Math.max(0, Math.min(current, stages.length - 1))]!]}</span>
            <span className="font-semibold text-fg tabular-nums">{job.status === "completed" ? 100 : job.progress}%</span>
          </div>
          <ProgressBar value={job.status === "completed" ? 100 : job.progress} indeterminate={job.status === "queued"} />

          <ol className="glass mt-6 rounded-[24px] px-4 py-2">
            {stages.map((s, i) => {
              const done = i < current;
              const now = i === current && active;
              return (
                <li key={s} className={cn("flex items-center gap-3.5 py-3", i > 0 && "border-t border-white/[0.05]")}>
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border transition-colors duration-500",
                      done ? "border-mint-300/30 bg-mint-400/15 text-mint-300" : now ? "border-lilac-300/40 bg-lilac-400/15 text-lilac-200" : "border-white/10 text-fg-dim",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : now ? <Spinner className="size-3.5 text-lilac-200" /> : <span className="size-1.5 rounded-full bg-current" />}
                  </span>
                  <span className={cn("flex-1 text-[14.5px]", done ? "text-fg-muted" : now ? "font-semibold text-fg" : "text-fg-dim")}>{t.job.stages[s]}</span>
                  {now && job.stageTotal ? <span className="text-[12.5px] text-fg-muted tabular-nums">{t.job.counter(job.stageDone ?? 0, job.stageTotal)}</span> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {job.status === "failed" ? (
        <section className="mt-6 px-5">
          <div className="glass rounded-[24px] p-5">
            <p className="text-[15px] leading-relaxed text-fg">{errorText(t, job.errorCode)}</p>
            {job.creditState === "released" && job.creditsCost > 0 ? <p className="mt-2 text-[14px] text-mint-300">{t.job.creditsReturned}</p> : null}
            {job.usedFreeAllowance ? <p className="mt-2 text-[14px] text-mint-300">{t.job.freeReturned}</p> : null}
          </div>
          <div className="mt-5 flex flex-col gap-2.5">
            <Button size="lg" block loading={retrying} onClick={retry}>
              <RotateCcw />
              {t.job.retry}
            </Button>
            <Button variant="secondary" block onClick={() => router.push(`/dreams/${id}`)}>
              {t.job.backToDream}
            </Button>
          </div>
        </section>
      ) : null}

      {job.status === "cancelled" ? (
        <section className="mt-6 px-5 text-center">
          {job.creditsCost > 0 || job.usedFreeAllowance ? <p className="text-[14px] text-mint-300">{job.usedFreeAllowance ? t.job.freeReturned : t.job.creditsReturned}</p> : null}
          <Button variant="secondary" className="mt-5" onClick={() => router.push(`/dreams/${id}`)}>
            {t.job.backToDream}
          </Button>
        </section>
      ) : null}

      {job.previews.length > 0 ? (
        <section className="mt-7 px-5">
          <SectionTitle>{t.job.previewsTitle}</SectionTitle>
          <ul className="grid grid-cols-3 gap-2.5">
            <AnimatePresence initial={false}>
              {job.previews.map((m) => (
                <motion.li key={m.id} initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="relative aspect-[9/16] overflow-hidden rounded-[16px] border border-white/[0.07] bg-night-800">
                  {m.thumbUrl || m.url ? <img src={m.thumbUrl ?? m.url ?? ""} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                  {m.isDemo ? (
                    <span className="absolute top-1.5 left-1.5">
                      <Badge tone="demo" className="h-5 px-1.5 text-[9px]">
                        {t.common.demo}
                      </Badge>
                    </span>
                  ) : null}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ) : null}

      {active ? (
        <section className="mt-7 px-5">
          <div className="flex gap-3 rounded-[22px] border border-white/[0.06] bg-white/[0.03] p-4">
            <Bell className="mt-0.5 size-5 shrink-0 text-lilac-300" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] leading-relaxed text-fg-muted">{t.job.closeNote}</p>
              {showWriteAccess ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[13px] text-fg-dim">{t.job.notifyAsk}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const ok = await requestWriteAccess();
                      if (ok) {
                        setNotifyGranted(true);
                        toast.success(t.job.notifyGranted);
                      }
                    }}
                  >
                    {t.job.notifyAllow}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              {t.job.cancel}
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t.job.cancelConfirmTitle}
        description={t.job.cancelConfirmText}
        confirmLabel={t.job.cancelConfirm}
        cancelLabel={t.job.keepGoing}
        tone="danger"
        onConfirm={cancel}
      />

      <PurchaseSheet
        open={purchase !== null}
        onOpenChange={(v) => {
          if (!v) setPurchase(null);
        }}
        need={purchase?.need}
        intent={purchase?.intent}
        onDone={({ jobId: newJob }) => {
          setPurchase(null);
          if (newJob) router.replace(`/dreams/${id}/jobs/${newJob}`);
        }}
      />
    </div>
  );
}
