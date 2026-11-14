"use client";

import { useState } from "react";
import { Film, ImageIcon, RefreshCw } from "lucide-react";
import type { DreamDetailDto, QuoteDto, SceneDto } from "@dream/core/dto";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useLocale, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { CoverImage } from "./cover";

/** Scene list with per-scene regeneration (priced from the quote). */
export function SceneList({ dream, quote, onRegenerate, busyScene }: { dream: DreamDetailDto; quote: QuoteDto | undefined; onRegenerate: (scene: SceneDto, kind: "image" | "video") => void; busyScene: string | null }) {
  const t = useT();
  const [locale] = useLocale();
  const [target, setTarget] = useState<SceneDto | null>(null);
  const hasSlideshow = dream.slideshows.length > 0;
  const hasVideo = dream.videos.length > 0;
  const canRegen = hasSlideshow || hasVideo;

  return (
    <>
      <ol className="flex flex-col gap-2.5">
        {dream.scenes.map((s) => (
          <li key={s.id} className="glass flex gap-3.5 rounded-[22px] p-3">
            <CoverImage src={s.image?.thumbUrl ?? s.image?.url} seed={s.id} alt="" className="h-[92px] w-[52px] shrink-0 rounded-[12px] border border-white/[0.06]" />
            <div className="min-w-0 flex-1 py-0.5">
              <p className="text-[14px] font-semibold text-fg">
                <span className="mr-1.5 text-fg-dim tabular-nums">{String(s.sequenceNumber).padStart(2, "0")}</span>
                {s.title ?? t.dream.sceneTitle(s.sequenceNumber)}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{s.description}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-fg-dim">
                {/* Camera directions are written in English for the image models — shown to English UI only. */}
                {s.cameraAngle && locale === "en" ? <span className="truncate">{s.cameraAngle}</span> : null}
                {s.status === "generating" ? <span className="text-lilac-300">•••</span> : null}
              </div>
            </div>
            {canRegen ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn("self-center", busyScene === s.id && "animate-spin")}
                aria-label={t.dream.regenerateScene}
                disabled={busyScene !== null}
                onClick={() => setTarget(s)}
              >
                <RefreshCw />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>

      <Sheet open={target !== null} onOpenChange={(v) => (!v ? setTarget(null) : undefined)} title={target ? (target.title ?? t.dream.sceneTitle(target.sequenceNumber)) : ""} description={t.dream.sceneRegenText}>
        {target ? (
          <div className="flex flex-col gap-2.5 pb-1">
            {hasSlideshow || !hasVideo ? (
              <Button
                variant="secondary"
                size="lg"
                block
                className="justify-between"
                onClick={() => {
                  onRegenerate(target, "image");
                  setTarget(null);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <ImageIcon />
                  {t.dream.newFrame}
                </span>
                <span className="text-fg-muted">{quote ? t.common.creditsShort(quote.sceneImageCredits) : "…"}</span>
              </Button>
            ) : null}
            {hasVideo ? (
              <Button
                variant="secondary"
                size="lg"
                block
                className="justify-between"
                onClick={() => {
                  onRegenerate(target, "video");
                  setTarget(null);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Film />
                  {t.dream.newClip}
                </span>
                <span className="text-fg-muted">{quote ? t.common.creditsShort(quote.sceneVideoCredits) : "…"}</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
