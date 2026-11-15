"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Film, Heart, Images } from "lucide-react";
import type { DreamCardDto } from "@dream/core/dto";
import { ProgressBar } from "@/components/ui/controls";
import { useLocale, useT } from "@/i18n";
import { formatDuration, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CoverImage } from "./cover";
import { routes } from "@dream/core/routes";

export function cardHref(item: DreamCardDto, tab?: "all" | "slideshow" | "video"): string {
  const s = item.dreamStatus;
  if (s === "draft" || s === "review" || s === "transcribing" || s === "transcription_failed") return routes.review(item.id);
  if (s === "analyzing" || s === "analysis_failed") return routes.prepare(item.id);
  if (item.status === "awaiting") return routes.prepare(item.id);
  if (item.activeJob && item.durationSec == null) return routes.job(item.id, item.activeJob.id);
  const view = tab && tab !== "all" ? tab : item.primaryFormat;
  return view ? routes.dream(item.id, view) : routes.dream(item.id);
}

function StatusPill({ item }: { item: DreamCardDto }) {
  const t = useT();
  const s = item.status;
  const label = item.dreamStatus === "transcribing" ? t.library.transcribing : item.dreamStatus === "analyzing" ? t.library.analyzing : t.library.status[s];
  const dot = s === "ready" ? "bg-mint-400" : s === "processing" ? "bg-lilac-300 animate-pulse" : s === "failed" ? "bg-rose-400" : s === "awaiting" ? "bg-gold-300" : "bg-fg-dim";
  return (
    <span className="inline-flex h-6 max-w-[calc(100%-28px)] items-center gap-1.5 rounded-full border border-white/10 bg-[rgb(8_9_18/0.62)] px-2.5 text-[10.5px] font-semibold text-fg/90 backdrop-blur-md">
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function DreamCard({ item, index, tab }: { item: DreamCardDto; index: number; tab?: "all" | "slideshow" | "video" }) {
  const t = useT();
  const [locale] = useLocale();
  const title = item.title ?? t.library.untitled;
  const formatLabel = item.primaryFormat === "video" ? t.formats.video : item.primaryFormat === "slideshow" ? t.formats.slideshow : null;
  const processing = item.status === "processing";

  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index % 12, 8) * 0.04, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
      <Link
        href={cardHref(item, tab)}
        className="group relative block aspect-[9/16] overflow-hidden rounded-[22px] border border-white/[0.07] bg-night-800 shadow-[0_20px_40px_-22px_rgb(0_0_0/0.9)] transition-transform duration-300 active:scale-[0.98]"
      >
        <CoverImage src={item.cover?.thumbUrl ?? item.cover?.url} seed={item.id} alt={title} className="absolute inset-0" imgClassName="transition-transform duration-700 group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(5_6_12/0.95)_0%,rgb(5_6_12/0.5)_40%,transparent_68%)]" aria-hidden />
        {processing ? <div className="decor-anim absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,transparent_30%,rgb(199_185_255/0.08)_50%,transparent_70%)]" aria-hidden /> : null}

        <div className="absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
          <StatusPill item={item} />
          {item.isFavorite ? <Heart className="mt-1 size-4 shrink-0 fill-rose-300 text-rose-300 drop-shadow" aria-label={t.dream.favorited} /> : null}
        </div>

        <div className="absolute inset-x-3 bottom-3">
          <h3 className="line-clamp-2 font-display text-[19px] leading-[1.1] font-medium text-fg">{title}</h3>
          <p className="mt-1.5 text-[11.5px] text-fg-muted">{formatShortDate(item.createdAt, locale)}</p>
          {formatLabel ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-lilac-200/90">
              {item.primaryFormat === "video" ? <Film className="size-3.5" aria-hidden /> : <Images className="size-3.5" aria-hidden />}
              <span>
                {formatLabel}
                {item.durationSec ? ` · ${formatDuration(item.durationSec)}` : ""}
              </span>
              {item.formats.slideshow && item.formats.video ? <span className="text-fg-dim">+1</span> : null}
            </p>
          ) : null}
          {item.activeJob ? (
            <div className="mt-2">
              <ProgressBar value={item.activeJob.progress} className="h-1" />
              <p className="mt-1 text-[10.5px] text-fg-muted">{t.library.processingProgress(item.activeJob.progress)}</p>
            </div>
          ) : null}
        </div>
      </Link>
    </motion.li>
  );
}

export function DreamCardSkeleton() {
  return <li className="skeleton aspect-[9/16] rounded-[22px] border border-white/[0.05]" aria-hidden />;
}
