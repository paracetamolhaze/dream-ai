"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Download, X } from "lucide-react";
import type { SceneDto } from "@dream/core/dto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { downloadMedia } from "@/lib/download";
import { fileNameFor } from "@/lib/format";
import { CoverImage } from "./cover";

/** Horizontal strip of scene frames + full-screen swipeable viewer. */
export function FramesStrip({ scenes, title }: { scenes: SceneDto[]; title: string }) {
  const t = useT();
  const withImages = scenes.filter((s) => s.image);
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (withImages.length === 0) return null;
  return (
    <>
      <ul className="no-scrollbar fade-x -mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
        {withImages.map((s, i) => (
          <li key={s.id} className="shrink-0 snap-start">
            <button type="button" onClick={() => setOpenAt(i)} className="relative block transition-transform active:scale-[0.97]" aria-label={`${t.dream.viewFrames}: ${s.title ?? t.dream.sceneTitle(s.sequenceNumber)}`}>
              <CoverImage src={s.image!.thumbUrl ?? s.image!.url} seed={s.id} alt="" className="h-[150px] w-[85px] rounded-[16px] border border-white/[0.07]" />
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/50 px-1.5 text-[10px] font-semibold text-white/90 tabular-nums backdrop-blur-sm">{String(s.sequenceNumber).padStart(2, "0")}</span>
            </button>
          </li>
        ))}
      </ul>
      <FramesGallery key={openAt ?? "closed"} scenes={withImages} startAt={openAt} onClose={() => setOpenAt(null)} title={title} />
    </>
  );
}

function FramesGallery({ scenes, startAt, onClose, title }: { scenes: SceneDto[]; startAt: number | null; onClose: () => void; title: string }) {
  const t = useT();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startAt ?? 0);
  const open = startAt !== null;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTo({ left: (startAt ?? 0) * el.clientWidth, behavior: "instant" as ScrollBehavior });
    });
  }, [open, startAt]);

  const scene = scenes[index];

  return (
    <Dialog.Root open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
        <Dialog.Content className="fixed inset-0 z-[70] flex flex-col bg-black outline-none data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in">
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{t.dream.frames}</Dialog.Description>
          <div className="flex items-center justify-between px-4 pt-[calc(var(--app-top)+10px)] pb-2">
            <span className="text-[13px] font-semibold text-white/80 tabular-nums">{t.dream.frameOf(index + 1, scenes.length)}</span>
            <Dialog.Close className="grid size-10 place-items-center rounded-full bg-white/10 text-white" aria-label={t.common.close}>
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div
            ref={scroller}
            className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            onScroll={(e) => {
              const el = e.currentTarget;
              const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (i !== index) setIndex(Math.max(0, Math.min(scenes.length - 1, i)));
            }}
          >
            {scenes.map((s) => (
              <div key={s.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center px-3">
                <img src={s.image!.url ?? s.image!.thumbUrl ?? ""} alt={s.title ?? ""} className="max-h-full max-w-full rounded-[18px] object-contain" />
              </div>
            ))}
          </div>
          {scene ? (
            <div className="px-5 pt-3 pb-[calc(var(--app-bottom)+18px)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[22px] leading-tight text-white">{scene.title ?? t.dream.sceneTitle(scene.sequenceNumber)}</p>
                  <p className="mt-1 line-clamp-3 text-[13.5px] leading-relaxed text-white/65">{scene.description}</p>
                </div>
                {scene.image?.isDemo ? <Badge tone="demo">{t.common.demo}</Badge> : null}
              </div>
              {scene.image?.downloadUrl ? (
                <Button
                  variant="secondary"
                  block
                  className="mt-4"
                  onClick={async () => {
                    const r = await downloadMedia(scene.image!.downloadUrl!, fileNameFor(`${title} ${scene.sequenceNumber}`, scene.image!.format || "jpg", "frame"));
                    if (r !== "declined") {
                      trackEvent("result_downloaded", { type: "image" });
                      toast.success(t.dream.downloadStarted);
                    }
                  }}
                >
                  <Download />
                  {t.dream.downloadFrame}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
