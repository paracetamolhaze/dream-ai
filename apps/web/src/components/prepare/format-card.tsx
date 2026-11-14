"use client";

import { motion } from "motion/react";
import { Check, Film, Images, Play } from "lucide-react";
import type { MediaDto } from "@dream/core/dto";
import { DreamPlaceholder } from "@/components/dream/cover";
import { Badge } from "@/components/ui/controls";
import { useT } from "@/i18n";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

interface FormatCardProps {
  format: "slideshow" | "video";
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  text: string;
  meta: string;
  price: React.ReactNode;
  tag: string;
  features: string[];
  seed: string;
  /** A curated example result or the dream's own preview frame. */
  visual?: { media: MediaDto; label: string } | null;
}

export function FormatCard({ format, selected, disabled, onSelect, title, text, meta, price, tag, features, seed, visual }: FormatCardProps) {
  const t = useT();
  return (
    <motion.button
      type="button"
      layout
      disabled={disabled}
      onClick={() => {
        haptic.select();
        onSelect();
      }}
      aria-pressed={selected}
      className={cn(
        "relative w-full overflow-hidden rounded-[28px] border p-4 text-left transition-[border-color,background-color,box-shadow] duration-300 disabled:opacity-50",
        selected
          ? "border-lilac-300/45 bg-[linear-gradient(160deg,rgb(174_156_251/0.14),rgb(114_193_209/0.04)_60%,transparent)] shadow-[0_24px_60px_-30px_rgb(150_128_255/0.7)]"
          : "border-white/[0.07] bg-white/[0.03]",
      )}
    >
      <div className="flex gap-4">
        <FormatVisual format={format} seed={seed} visual={visual} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.12em] text-lilac-300 uppercase">
              {format === "video" ? <Film className="size-3.5" aria-hidden /> : <Images className="size-3.5" aria-hidden />}
              {tag}
            </span>
            <span className={cn("grid size-6 place-items-center rounded-full border transition-colors", selected ? "border-lilac-200 bg-lilac-200 text-night-950" : "border-white/15")} aria-hidden>
              {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
          </div>
          <h3 className="mt-2 font-display text-[23px] leading-[1.08] font-medium text-fg">{title}</h3>
          <p className="mt-1.5 text-[13.5px] leading-snug text-fg-muted">{text}</p>
          <div className="mt-auto flex items-end justify-between gap-2 pt-3">
            <span className="text-[12.5px] text-fg-dim">{meta}</span>
            <span className="shrink-0 text-[14px] font-bold text-fg">{price}</span>
          </div>
        </div>
      </div>
      {selected ? (
        <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-white/[0.06] pt-3.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-muted">
              <Check className="mt-0.5 size-3.5 shrink-0 text-mint-300" aria-hidden />
              {f}
            </li>
          ))}
        </motion.ul>
      ) : null}
      {visual ? <span className="sr-only">{visual.label}</span> : null}
      {visual?.media.isDemo ? (
        <span className="absolute top-3 left-3">
          <Badge tone="demo">{t.common.demo}</Badge>
        </span>
      ) : null}
    </motion.button>
  );
}

/**
 * Small illustration: the real example/preview frame when we have one,
 * otherwise an abstract composition that doesn't pretend to be a result.
 */
function FormatVisual({ format, seed, visual }: { format: "slideshow" | "video"; seed: string; visual?: { media: MediaDto; label: string } | null }) {
  const src = visual?.media.thumbUrl ?? visual?.media.url ?? null;
  if (format === "slideshow") {
    return (
      <div className="relative h-[132px] w-[86px] shrink-0">
        <DreamPlaceholder seed={`${seed}-c`} className="absolute top-3 left-0 h-[108px] w-[62px] -rotate-[9deg] rounded-[12px] border border-white/10 opacity-70" />
        <DreamPlaceholder seed={`${seed}-b`} className="absolute top-1.5 right-0 h-[108px] w-[62px] rotate-[8deg] rounded-[12px] border border-white/10 opacity-80" />
        <div className="absolute top-0 left-1/2 h-[118px] w-[68px] -translate-x-1/2 overflow-hidden rounded-[14px] border border-white/15 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)]">
          {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <DreamPlaceholder seed={`${seed}-a`} className="h-full w-full" />}
        </div>
        <div className="absolute inset-x-1 bottom-0 flex justify-center gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1 rounded-full", i === 0 ? "w-4 bg-lilac-200" : "w-1.5 bg-white/20")} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative h-[132px] w-[86px] shrink-0 overflow-hidden rounded-[16px] border border-white/15 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)]">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <DreamPlaceholder seed={`${seed}-v`} className="h-full w-full" />}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgb(5_6_12/0.7))]" />
      <div className="decor-anim absolute inset-y-0 -left-1/2 w-1/2 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.12),transparent)]" aria-hidden />
      <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-night-950 shadow-lg" aria-hidden>
        <Play className="ml-0.5 size-4 fill-current" />
      </span>
      <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/20" aria-hidden>
        <div className="h-full w-2/5 rounded-full bg-lilac-200" />
      </div>
    </div>
  );
}
