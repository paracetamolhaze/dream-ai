"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronRight, Download, Film, Heart, Images, MessageCircle, PenLine, Play, RefreshCw, Share2, Trash2, TriangleAlert } from "lucide-react";
import type { DreamDetailDto, MediaDto, SceneDto, StartGenerationResponse } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState } from "@/components/app/states";
import { DreamPlaceholder } from "@/components/dream/cover";
import { FramesStrip } from "@/components/dream/frames-gallery";
import { MediaPlayer } from "@/components/dream/media-player";
import { SceneList } from "@/components/dream/scene-list";
import { ShareSheet } from "@/components/dream/share-sheet";
import { PurchaseSheet } from "@/components/purchase/purchase-sheet";
import { AudioPreview } from "@/components/record/audio-preview";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Chip, ProgressBar, SectionTitle, Segmented, Spinner } from "@/components/ui/controls";
import { Sheet } from "@/components/ui/sheet";
import { TextInput } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useLocale, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { api, isApiError } from "@/lib/api";
import { downloadMedia } from "@/lib/download";
import { fileNameFor, formatDate, formatDuration } from "@/lib/format";
import { qk, useDream, useQuote } from "@/lib/queries";
import { haptic } from "@/lib/telegram";
import { cn, uuid } from "@/lib/utils";
import { routes } from "@dream/core/routes";

const ease = [0.22, 1, 0.36, 1] as const;
type View = "slideshow" | "video";

export default function DreamPage() {
  return (
    <Suspense>
      <DreamDetail />
    </Suspense>
  );
}

function DreamDetail() {
  const id = useSearchParams().get("id") ?? "";
  const search = useSearchParams();
  const t = useT();
  const [locale] = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const dreamQ = useDream(id);
  const d = dreamQ.data;
  const quoteQ = useQuote(id, d?.status === "ready");

  const requestedView = search.get("view") as View | null;
  const [chosenView, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<Record<View, string | null>>({ slideshow: null, video: null });
  const [playSignal, setPlaySignal] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  // "Show more" appears whenever the 5-line clamp actually hides text (measured, not guessed by length).
  const [storyClamped, setStoryClamped] = useState(false);
  const storyRef = useCallback((el: HTMLParagraphElement | null) => {
    if (!el) return;
    const measure = () => setStoryClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Format view: the user's choice, else ?view=, else whatever exists (video first).
  const has = (v: View) => Boolean(d && (v === "video" ? d.videos.length > 0 : d.slideshows.length > 0));
  const view: View | null =
    chosenView && has(chosenView) ? chosenView : requestedView && has(requestedView) ? requestedView : has("video") ? "video" : has("slideshow") ? "slideshow" : null;
  // Newest version first; a new version (e.g. after regeneration) is shown automatically.
  const list: MediaDto[] = !d || !view ? [] : view === "video" ? d.videos : d.slideshows;
  const current = list.find((m) => m.id === selected[view ?? "slideshow"]) ?? list[0] ?? null;
  const title = d?.title ?? t.dream.untitled;
  const bothFormats = Boolean(d && d.videos.length > 0 && d.slideshows.length > 0);

  async function patch(body: Record<string, unknown>) {
    const updated = await api<DreamDetailDto>(`/api/dreams/${id}`, { method: "PATCH", body });
    qc.setQueryData(qk.dream(id), updated);
    void qc.invalidateQueries({ queryKey: qk.libraryAll });
    return updated;
  }

  async function toggleFavorite() {
    if (!d) return;
    haptic.impact("light");
    const next = !d.isFavorite;
    qc.setQueryData<DreamDetailDto>(qk.dream(id), { ...d, isFavorite: next });
    try {
      await patch({ isFavorite: next });
    } catch (err) {
      qc.setQueryData<DreamDetailDto>(qk.dream(id), { ...d, isFavorite: !next });
      toast.error(errorMessage(err));
    }
  }

  async function download() {
    if (!current?.downloadUrl) return;
    const outcome = await downloadMedia(current.downloadUrl, fileNameFor(title, "mp4", "dream"));
    if (outcome !== "declined") {
      trackEvent("result_downloaded", { type: current.type, via: outcome });
      toast.success(t.dream.downloadStarted);
    }
  }

  async function sendToChat() {
    if (!current) return;
    setSending(true);
    try {
      await api(`/api/dreams/${id}/send-to-chat`, { method: "POST", body: { mediaId: current.id } });
      trackEvent("result_shared", { via: "send_to_chat", type: current.type });
      toast.success(t.dream.sentToChat);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function regenerateScene(scene: SceneDto, kind: "image" | "video") {
    setBusyScene(scene.id);
    try {
      const res = await api<StartGenerationResponse>(`/api/dreams/${id}/scenes/${scene.id}/regenerate`, { method: "POST", body: { kind, idempotencyKey: uuid() } });
      void qc.invalidateQueries({ queryKey: qk.profile });
      router.push(routes.job(id, res.job.id));
    } catch (err) {
      if (isApiError(err, "insufficient_credits")) setPurchaseOpen(true);
      else toast.error(errorMessage(err));
    } finally {
      setBusyScene(null);
    }
  }

  async function remove() {
    try {
      await api(`/api/dreams/${id}`, { method: "DELETE", timeoutMs: 120_000 });
      qc.removeQueries({ queryKey: qk.dream(id) });
      void qc.invalidateQueries({ queryKey: qk.libraryAll });
      toast.success(t.dream.deleted);
      router.replace("/dreams");
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
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

  if (!d) {
    return (
      <div className="min-h-app">
        <PageHeader backHref="/dreams" />
        <div className="px-5 pt-4">
          <div className="skeleton h-10 w-2/3 rounded-xl" />
          <div className="skeleton mt-3 h-4 w-1/3 rounded-lg" />
          <div className="skeleton mx-auto mt-6 aspect-[9/16] w-full max-w-[min(420px,42vh)] rounded-[28px]" />
        </div>
      </div>
    );
  }

  const other: View = view === "video" ? "slideshow" : "video";
  const activeJob = d.activeJobs.find((j) => j.kind === "full") ?? d.activeJobs[0];

  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+32px)]">
      <PageHeader
        backHref="/dreams"
        right={
          <Button variant="ghost" size="icon" onClick={toggleFavorite} aria-label={d.isFavorite ? t.dream.favorited : t.dream.favorite} aria-pressed={d.isFavorite}>
            <Heart className={cn(d.isFavorite && "fill-rose-300 text-rose-300")} />
          </Button>
        }
      />

      <section className="px-5">
        <button type="button" onClick={() => setRenameOpen(true)} className="group flex w-full items-start gap-2 text-left" aria-label={t.dream.rename}>
          <h1 className="font-display text-[38px] leading-[1.03] font-medium text-moon">{title}</h1>
          <PenLine className="mt-3 size-4 shrink-0 text-fg-dim group-hover:text-fg-muted" aria-hidden />
        </button>
        <p className="mt-2 text-[13.5px] text-fg-muted">
          {t.dream.recordedAt(formatDate(d.createdAt, locale))}
          {d.atmosphere ? <span className="text-fg-dim"> · {d.atmosphere}</span> : null}
        </p>
      </section>

      {activeJob ? (
        <Link href={routes.job(id, activeJob.id)} className="glass mx-5 mt-5 flex items-center gap-3.5 rounded-[22px] p-4 transition-transform active:scale-[0.99]">
          <Spinner className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-fg">{t.dream.activeJob(activeJob.mediaType === "video", activeJob.progress)}</p>
            <ProgressBar value={activeJob.progress} className="mt-2 h-1" />
          </div>
          <ChevronRight className="size-5 text-fg-dim" aria-hidden />
        </Link>
      ) : d.lastFailedJob ? (
        <Link href={routes.job(id, d.lastFailedJob.id)} className="mx-5 mt-5 flex items-center gap-3 rounded-[22px] border border-rose-400/20 bg-rose-400/[0.06] p-4">
          <TriangleAlert className="size-5 shrink-0 text-rose-300" aria-hidden />
          <p className="flex-1 text-[14px] text-fg">{t.dream.lastFailed}</p>
          <ChevronRight className="size-5 text-fg-dim" aria-hidden />
        </Link>
      ) : null}

      <section className="mt-6 px-5">
        {bothFormats && view ? (
          <Segmented
            className="mb-4"
            label={t.formats.slideshow}
            value={view}
            onChange={(v) => setView(v)}
            options={[
              { value: "slideshow", label: t.formats.slideshow },
              { value: "video", label: t.formats.video },
            ]}
          />
        ) : null}
        {list.length > 1 ? (
          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5">
            {list.map((m, i) => (
              <Chip key={m.id} active={current?.id === m.id} onClick={() => setSelected((s) => ({ ...s, [view!]: m.id }))}>
                {t.dream.version(list.length - i)}
                {m.durationSec ? <span className="text-fg-dim">· {formatDuration(m.durationSec)}</span> : null}
              </Chip>
            ))}
          </div>
        ) : null}

        {current ? (
          <motion.div key={current.id} initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease }}>
            <MediaPlayer media={current} onReload={() => void dreamQ.refetch()} playSignal={playSignal} />
          </motion.div>
        ) : activeJob ? (
          <DreamPlaceholder seed={d.id} className="mx-auto aspect-[9/16] w-full max-w-[min(420px,42vh)] rounded-[28px] border border-white/[0.07]">
            <div className="absolute inset-0 grid place-items-center">
              <Spinner className="size-8" />
            </div>
          </DreamPlaceholder>
        ) : (
          <div className="glass rounded-[28px]">
            <EmptyState
              title={t.dream.noResultTitle}
              text={t.dream.noResultText}
              action={
                d.status === "ready" ? (
                  <Button onClick={() => router.push(routes.prepare(id))}>{t.dream.chooseFormat}</Button>
                ) : (
                  <Button onClick={() => router.push(routes.review(id))}>{t.common.continue}</Button>
                )
              }
            />
          </div>
        )}
      </section>

      {current ? (
        <section className="mt-5 px-5">
          <div className="grid grid-cols-4 gap-2">
            <ActionTile icon={<Play className="fill-current" />} label={t.dream.watch} onClick={() => setPlaySignal((n) => n + 1)} />
            <ActionTile icon={<Download />} label={t.dream.download} onClick={download} />
            <ActionTile icon={<Share2 />} label={t.dream.share} onClick={() => setShareOpen(true)} primary />
            <ActionTile icon={<MessageCircle />} label={t.dream.sendToChat} onClick={sendToChat} busy={sending} />
          </div>
        </section>
      ) : null}

      {d.status === "ready" ? (
        <section className="mt-3 grid grid-cols-2 gap-2 px-5">
          <Button variant="secondary" block onClick={() => router.push(routes.prepare(id, { format: view ? other : "video" }))}>
            {other === "video" ? <Film /> : <Images />}
            {other === "video" ? t.dream.createVideo : t.dream.createSlideshow}
          </Button>
          <Button variant="secondary" block disabled={!view} onClick={() => router.push(routes.prepare(id, { format: view ?? "slideshow", regen: true }))}>
            <RefreshCw />
            {t.dream.regenerate}
          </Button>
        </section>
      ) : null}

      {view === "slideshow" || (!view && d.scenes.some((s) => s.image)) ? (
        <section className="mt-8 px-5">
          <SectionTitle>{t.dream.frames}</SectionTitle>
          <FramesStrip scenes={d.scenes} title={title} />
        </section>
      ) : null}

      {d.editedText ? (
        <section className="mt-8 px-5">
          <SectionTitle>{t.dream.story}</SectionTitle>
          <div className="glass rounded-[22px] p-4">
            <p ref={storyRef} className={cn("text-[15px] leading-[1.7] whitespace-pre-line text-fg/90", !storyOpen && "line-clamp-5")}>{d.editedText}</p>
            {storyOpen || storyClamped ? (
              <button type="button" onClick={() => setStoryOpen((v) => !v)} className="mt-2 text-[13px] font-semibold text-lilac-300">
                {storyOpen ? t.dream.showLess : t.dream.showMore}
              </button>
            ) : null}
            {d.audioUrl ? <AudioPreview className="mt-4" src={d.audioUrl} knownDurationSec={d.audioDurationSec} label={t.dream.audio} /> : null}
          </div>
        </section>
      ) : null}

      {d.scenes.length > 0 ? (
        <section className="mt-8 px-5">
          <SectionTitle>{t.dream.scenes}</SectionTitle>
          <SceneList dream={d} quote={quoteQ.data} onRegenerate={regenerateScene} busyScene={busyScene} />
        </section>
      ) : null}

      <section className="mt-10 flex justify-center px-5">
        <Button variant="ghost" className="text-rose-300/80 hover:text-rose-300" onClick={() => setDeleteOpen(true)}>
          <Trash2 />
          {t.dream.delete}
        </Button>
      </section>

      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} dream={d} media={current} onDownload={download} />
      <RenameSheet open={renameOpen} onOpenChange={setRenameOpen} initial={d.title ?? ""} onSave={async (v) => void (await patch({ title: v }))} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t.dream.deleteTitle} description={t.dream.deleteText} confirmLabel={t.common.delete} cancelLabel={t.common.cancel} tone="danger" onConfirm={remove} />
      <PurchaseSheet open={purchaseOpen} onOpenChange={setPurchaseOpen} onDone={() => setPurchaseOpen(false)} />
    </div>
  );
}

function ActionTile({ icon, label, onClick, primary, busy, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.impact("light");
        onClick();
      }}
      disabled={disabled || busy}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-[20px] border px-1 py-3 text-[11.5px] font-semibold transition-[transform,background-color] active:scale-[0.97] disabled:opacity-50 [&_svg]:size-5",
        primary ? "border-lilac-300/30 bg-lilac-400/[0.12] text-lilac-100" : "border-white/[0.07] bg-white/[0.035] text-fg",
      )}
    >
      {busy ? <Spinner className="size-5" /> : icon}
      <span className="line-clamp-1">{label}</span>
    </button>
  );
}

function RenameSheet({ open, onOpenChange, initial, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; initial: string; onSave: (v: string) => Promise<void> }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t.dream.renameTitle}>
      {open ? <RenameForm initial={initial} onSave={onSave} onDone={() => onOpenChange(false)} /> : null}
    </Sheet>
  );
}

function RenameForm({ initial, onSave, onDone }: { initial: string; onSave: (v: string) => Promise<void>; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4 pb-[calc(var(--app-bottom)+4px)]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        try {
          await onSave(value.trim());
          toast.success(t.prepare.titleSaved);
          onDone();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextInput value={value} onChange={(e) => setValue(e.target.value.slice(0, 80))} placeholder={t.dream.renamePlaceholder} aria-label={t.dream.renameTitle} autoFocus />
      <Button type="submit" size="lg" block loading={busy} disabled={!value.trim()}>
        {t.common.save}
      </Button>
    </form>
  );
}
