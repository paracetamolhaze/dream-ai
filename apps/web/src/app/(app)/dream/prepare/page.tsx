"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, PenLine, Sparkles } from "lucide-react";
import type { DreamDetailDto, MusicTrackDto, StartGenerationBody, StartGenerationResponse } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/states";
import { DreamOrb } from "@/components/dream/orb";
import { FormatCard } from "@/components/prepare/format-card";
import { DurationPicker, MusicPicker, StylePicker } from "@/components/prepare/pickers";
import { useMe } from "@/components/providers/session";
import { PurchaseSheet, type PurchaseIntent } from "@/components/purchase/purchase-sheet";
import { Button } from "@/components/ui/button";
import { Badge, SectionTitle } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { api, isApiError, upload } from "@/lib/api";
import { rememberJobOptions, useIdempotencyKey } from "@/lib/generation";
import { qk, useDream, useQuote } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { routes } from "@dream/core/routes";

const ease = [0.22, 1, 0.36, 1] as const;
type Format = "slideshow" | "video";

export default function PreparePage() {
  return (
    <Suspense>
      <Prepare />
    </Suspense>
  );
}

function Prepare() {
  const id = useSearchParams().get("id") ?? "";
  const search = useSearchParams();
  const requested = search.get("format");
  const regen = search.get("regen") === "1";
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const dreamQ = useDream(id);
  const d = dreamQ.data;
  const ready = d?.status === "ready";
  const quoteQ = useQuote(id, ready);
  const q = quoteQ.data;

  // User choices (null/undefined = not chosen yet → derived defaults below).
  const [chosenFormat, setFormat] = useState<Format>(requested === "video" ? "video" : "slideshow");
  const [chosenStyle, setStyleId] = useState<string | null>(null);
  const [chosenMusic, setMusicId] = useState<string | null | undefined>(undefined);
  const [chosenDuration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState<{ need: number; intent: PurchaseIntent } | null>(null);
  const [musicUploading, setMusicUploading] = useState(false);
  const idem = useIdempotencyKey();

  // Not confirmed yet → back to the transcript review.
  useEffect(() => {
    if (!d) return;
    if (d.status === "review" || d.status === "draft" || d.status === "transcribing" || d.status === "transcription_failed") router.replace(routes.review(id));
  }, [d, id, router]);

  useEffect(() => {
    if (ready) trackEvent("generation_screen_opened", { regen });
  }, [ready, regen]);

  // Sensible defaults derived from the quote.
  const format: Format = q && q.video.options.length === 0 ? "slideshow" : chosenFormat;
  // Default style is "Кинематографичный" (spec); a regeneration keeps the style the dream was made with.
  const styleId =
    chosenStyle ??
    (q ? ((regen ? q.styles.find((s) => s.id === d?.visualStyle)?.id : undefined) ?? q.styles.find((s) => s.id === "cinematic")?.id ?? q.styles[0]?.id ?? null) : null);
  const duration = chosenDuration ?? (q ? (q.video.options.find((o) => o.targetSec === 15)?.targetSec ?? q.video.options[0]?.targetSec ?? null) : null);
  const musicId = chosenMusic !== undefined ? chosenMusic : (q?.music.find((m) => !m.isOwn)?.id ?? null);

  const videoOption = q?.video.options.find((o) => o.targetSec === duration) ?? null;
  const cost = !q ? 0 : format === "slideshow" ? (q.slideshow.free ? 0 : q.slideshow.credits) : (videoOption?.credits ?? 0);
  const anyDemo = q ? q.demo.image || q.demo.llm || (format === "video" && q.demo.video) : false;

  const preview = d?.preview ? { media: d.preview, label: t.prepare.previewLabel } : null;
  const visuals = {
    slideshow: q?.examples.slideshow ? { media: q.examples.slideshow, label: t.prepare.exampleLabel } : preview,
    video: q?.examples.video ? { media: q.examples.video, label: t.prepare.exampleLabel } : preview,
  };

  function selectFormat(f: Format) {
    setFormat(f);
    trackEvent(f === "video" ? "video_selected" : "slideshow_selected");
  }

  async function uploadMusic(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error(t.errors.audio_too_large!);
      return;
    }
    setMusicUploading(true);
    try {
      const form = new FormData();
      form.set("audio", file, file.name);
      form.set("title", file.name.replace(/\.[^.]+$/, "").slice(0, 60) || t.prepare.ownTrack);
      const track = await upload<MusicTrackDto>("/api/music", form);
      await qc.invalidateQueries({ queryKey: qk.quote(id) });
      setMusicId(track.id);
      toast.success(t.prepare.musicUploaded);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMusicUploading(false);
    }
  }

  async function create() {
    if (!q || !styleId) return;
    if (format === "video" && !videoOption) return;
    const options: Omit<StartGenerationBody, "idempotencyKey"> =
      format === "video" ? { format, styleId, targetDurationSec: videoOption!.targetSec, musicTrackId: null } : { format, styleId, musicTrackId: musicId ?? null };
    const body: StartGenerationBody = { ...options, idempotencyKey: idem.keyFor(options) };
    setBusy(true);
    try {
      const res = await api<StartGenerationResponse>(`/api/dreams/${id}/generate`, { method: "POST", body });
      rememberJobOptions(res.job.id, body);
      void qc.invalidateQueries({ queryKey: qk.profile });
      void qc.invalidateQueries({ queryKey: qk.libraryAll });
      void qc.invalidateQueries({ queryKey: qk.dream(id) });
      router.push(routes.job(id, res.job.id));
    } catch (err) {
      setBusy(false);
      if (isApiError(err, "insufficient_credits")) {
        setPurchase({ need: cost, intent: { dreamId: id, body } });
        return;
      }
      if (isApiError(err, "job_already_running")) {
        const fresh = await dreamQ.refetch();
        const active = fresh.data?.activeJobs.find((j) => j.mediaType === format);
        if (active) {
          router.push(routes.job(id, active.id));
          return;
        }
      }
      toast.error(errorMessage(err));
    }
  }

  if (dreamQ.isError) {
    const notFound = isApiError(dreamQ.error, "not_found");
    return (
      <div className="min-h-app">
        <PageHeader backHref="/dreams" />
        <ErrorState title={notFound ? t.dream.notFoundTitle : t.app.errorTitle} text={notFound ? t.dream.notFoundText : errorMessage(dreamQ.error)} onRetry={notFound ? undefined : () => void dreamQ.refetch()} retryLabel={t.common.tryAgain} />
      </div>
    );
  }

  const analyzing = !d || d.status === "analyzing" || d.status === "transcribing";

  return (
    <div className="flex min-h-app flex-col">
      <PageHeader backHref="/dreams" />
      <AnimatePresence mode="wait" initial={false}>
        {analyzing ? (
          <AnalyzingView key="analyzing" />
        ) : d.status === "analysis_failed" ? (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col items-center justify-center px-5 pb-20">
            <ErrorState
              title={t.prepare.failedTitle}
              text={d.errorCode && t.errors[d.errorCode] && d.errorCode !== "analysis_failed" ? `${t.errors[d.errorCode]} ${t.prepare.failedText}` : t.prepare.failedText}
              onRetry={async () => {
                try {
                  const res = await api<{ dream: DreamDetailDto }>(`/api/dreams/${id}/confirm`, { method: "POST", body: {} });
                  qc.setQueryData(qk.dream(id), res.dream);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
              retryLabel={t.common.tryAgain}
            />
            <Button variant="ghost" onClick={() => router.push(routes.review(id, { edit: true }))}>
              <PenLine />
              {t.prepare.editText}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="ready" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="flex flex-1 flex-col">
            <DreamSummary dream={d} />

            <section className="mt-9 px-5">
              <SectionTitle>{t.prepare.chooseFormat}</SectionTitle>
              {anyDemo ? (
                <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-3.5">
                  <Badge tone="demo">{t.common.demo}</Badge>
                  <p className="text-[13px] leading-relaxed text-amber-300/90">{t.prepare.demoNotice}</p>
                </div>
              ) : null}
              {!q && quoteQ.isError ? (
                <div className="glass flex flex-col items-start gap-3 rounded-[28px] p-5">
                  <p className="text-[14px] leading-relaxed text-fg-muted">{t.common.loadFailed}</p>
                  <Button variant="secondary" size="sm" onClick={() => void quoteQ.refetch()}>
                    {t.common.retry}
                  </Button>
                </div>
              ) : !q ? (
                <div className="grid gap-3">
                  <div className="skeleton h-[168px] rounded-[28px]" />
                  <div className="skeleton h-[168px] rounded-[28px]" />
                </div>
              ) : (
                <div className="grid gap-3">
                  <FormatCard
                    format="slideshow"
                    selected={format === "slideshow"}
                    onSelect={() => selectFormat("slideshow")}
                    tag={t.formats.economical}
                    title={t.formats.slideshowTitle}
                    text={t.formats.slideshowText}
                    meta={t.formats.slideshowMeta(q.slideshow.sceneCount, q.slideshow.estimatedSec)}
                    price={q.slideshow.free ? <span className="text-mint-300">{t.common.free}</span> : t.common.creditsShort(q.slideshow.credits)}
                    features={t.formats.slideshowFeatures}
                    seed={d.id}
                    visual={visuals.slideshow}
                  />
                  <FormatCard
                    format="video"
                    selected={format === "video"}
                    disabled={q.video.options.length === 0}
                    onSelect={() => selectFormat("video")}
                    tag={t.formats.cinematic}
                    title={t.formats.videoTitle}
                    text={q.video.options.length === 0 ? t.prepare.noVideoOptions : t.formats.videoText}
                    meta={
                      q.video.options.length
                        ? t.formats.videoMeta(Math.min(...q.video.options.map((o) => o.actualSec)), Math.max(...q.video.options.map((o) => o.actualSec)))
                        : "—"
                    }
                    price={q.video.options.length ? t.formats.from(Math.min(...q.video.options.map((o) => o.credits))) : null}
                    features={t.formats.videoFeatures}
                    seed={d.id}
                    visual={visuals.video}
                  />
                </div>
              )}
            </section>

            {q ? (
              <section className="mt-8 flex flex-col gap-8 px-5">
                <div>
                  <SectionTitle>{t.prepare.style}</SectionTitle>
                  <StylePicker styles={q.styles} value={styleId ?? ""} onChange={setStyleId} />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {format === "slideshow" ? (
                    <motion.div key="music" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
                      <SectionTitle>{t.prepare.music}</SectionTitle>
                      <MusicPicker tracks={q.music} value={musicId ?? null} onChange={setMusicId} onUpload={uploadMusic} uploading={musicUploading} />
                    </motion.div>
                  ) : (
                    <motion.div key="duration" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
                      <SectionTitle>{t.prepare.duration}</SectionTitle>
                      <DurationPicker options={q.video.options} value={duration} onChange={setDuration} />
                    </motion.div>
                  )}
                </AnimatePresence>
                {q.watermark.applies || regen ? (
                  <div className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-dim">
                    {q.watermark.applies ? (
                      <p>
                        {t.prepare.watermarkNote} {q.watermark.removableByPurchase ? t.prepare.watermarkRemovable : null}
                      </p>
                    ) : null}
                    {regen ? <p>{t.prepare.regenerateNote}</p> : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="sticky bottom-0 mt-8 bg-[linear-gradient(to_top,var(--color-night-950)_62%,transparent)] px-5 pt-6 pb-[calc(var(--app-bottom)+16px)]">
              <div className="mb-2.5 flex items-center justify-between px-1 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 text-fg-muted">
                  <Sparkles className="size-3.5 text-gold-300" aria-hidden />
                  {t.prepare.balance(me.balance)}
                </span>
                {q && q.freeSlideshowsLeft > 0 && format === "slideshow" ? <span className="text-mint-300">{t.prepare.freeLeft(q.freeSlideshowsLeft)}</span> : null}
              </div>
              <Button size="lg" block disabled={!q || !styleId || (format === "video" && !videoOption)} loading={busy} onClick={create} haptics="medium">
                {format === "video" ? t.prepare.createVideo : t.prepare.createSlideshow}
                <span className="opacity-60">·</span>
                {cost === 0 ? t.common.free : t.common.creditsShort(cost)}
                <ArrowRight />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PurchaseSheet
        open={purchase !== null}
        onOpenChange={(v) => {
          if (!v) setPurchase(null);
        }}
        need={purchase?.need}
        intent={purchase?.intent}
        onDone={({ jobId }) => {
          setPurchase(null);
          if (jobId) router.push(routes.job(id, jobId));
        }}
      />
    </div>
  );
}

function AnalyzingView() {
  const t = useT();
  const phases = t.prepare.analyzingPhases;
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((x) => (x + 1) % phases.length), 2600);
    return () => clearInterval(timer);
  }, [phases.length]);
  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="flex flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
      <DreamOrb variant="think" />
      <h1 className="mt-8 font-display text-[34px] leading-tight font-medium text-moon">{t.prepare.analyzingTitle}</h1>
      <div className="relative mt-3 h-6 w-full max-w-[320px] overflow-hidden" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease }} className="text-[15px] text-fg-muted">
            {phases[i]}
          </motion.p>
        </AnimatePresence>
      </div>
      <p className="mt-6 text-[12.5px] text-fg-dim">{t.prepare.analyzingNote}</p>
    </motion.section>
  );
}

function DreamSummary({ dream }: { dream: DreamDetailDto }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(dream.title ?? "");
  const [saving, setSaving] = useState(false);
  const [allScenes, setAllScenes] = useState(false);
  const scenes = allScenes ? dream.scenes : dream.scenes.slice(0, 3);

  async function saveTitle() {
    const value = title.trim();
    if (!value || value === dream.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api<DreamDetailDto>(`/api/dreams/${dream.id}`, { method: "PATCH", body: { title: value } });
      qc.setQueryData(qk.dream(dream.id), updated);
      void qc.invalidateQueries({ queryKey: qk.libraryAll });
      toast.success(t.prepare.titleSaved);
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-5 pt-1">
      <p className="text-[12px] font-semibold tracking-[0.16em] text-lilac-300/80 uppercase">{t.prepare.yourDream}</p>
      {editing ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveTitle();
          }}
        >
          <TextInput value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} autoFocus aria-label={t.prepare.titleLabel} placeholder={t.dream.renamePlaceholder} />
          <Button type="submit" size="icon" loading={saving} aria-label={t.common.save}>
            {saving ? null : <Check />}
          </Button>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="group mt-1.5 flex w-full items-start gap-2 text-left" aria-label={t.prepare.titleLabel}>
          <h1 className="font-display text-[40px] leading-[1.02] font-medium text-moon">{dream.title ?? t.dream.untitled}</h1>
          <PenLine className="mt-3 size-4 shrink-0 text-fg-dim transition-colors group-hover:text-fg-muted" aria-hidden />
        </button>
      )}
      {dream.atmosphere ? <p className="mt-2 font-display text-[18px] text-lilac-200/80 italic">{dream.atmosphere}</p> : null}
      {dream.summary ? <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{dream.summary}</p> : null}
      {dream.analysisIsDemo ? (
        <div className="mt-3">
          <Badge tone="demo">{t.common.demo}</Badge>
        </div>
      ) : null}

      {dream.characters.length + dream.locations.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {dream.characters.map((c) => (
            <span key={c.key} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 text-[13px] text-fg" title={c.visualTag}>
              <span className="size-1.5 rounded-full bg-lilac-300" aria-hidden />
              {c.name}
            </span>
          ))}
          {dream.locations.map((l) => (
            <span key={l.key} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 text-[13px] text-fg-muted" title={l.description}>
              <span className="size-1.5 rounded-full bg-mist-400" aria-hidden />
              {l.name}
            </span>
          ))}
        </div>
      ) : null}

      {dream.scenes.length > 0 ? (
        <div className="mt-6">
          <SectionTitle>{t.prepare.plot(dream.scenes.length)}</SectionTitle>
          <ol className="relative ml-1 border-l border-white/[0.08] pl-5">
            {scenes.map((s, idx) => (
              <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05, duration: 0.4, ease }} className="relative pb-4 last:pb-0">
                <span className="absolute top-1 -left-[27px] grid size-[13px] place-items-center rounded-full border border-lilac-300/40 bg-night-950" aria-hidden>
                  <span className="size-[5px] rounded-full bg-lilac-300" />
                </span>
                <p className="text-[14px] font-semibold text-fg">
                  <span className="mr-1.5 text-fg-dim tabular-nums">{String(s.sequenceNumber).padStart(2, "0")}</span>
                  {s.title ?? t.dream.sceneTitle(s.sequenceNumber)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-relaxed text-fg-muted">{s.description}</p>
              </motion.li>
            ))}
          </ol>
          {dream.scenes.length > 3 ? (
            <button type="button" onClick={() => setAllScenes((v) => !v)} className={cn("mt-3 ml-6 text-[13px] font-semibold text-lilac-300")}>
              {allScenes ? t.prepare.collapse : t.prepare.showAllScenes(dream.scenes.length)}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
