"use client";

import { cn } from "@/lib/utils";

/** Calm animated orb used for "listening" / "thinking" states (CSS only, no fake progress). */
export function DreamOrb({ variant = "listen", className }: { variant?: "listen" | "think" | "create"; className?: string }) {
  return (
    <div className={cn("relative grid size-44 place-items-center", className)} aria-hidden>
      <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.38),rgb(114_193_209/0.08)_60%,transparent)]" />
      {variant === "listen" ? (
        <>
          <span className="decor-anim absolute size-24 animate-listen rounded-full border border-lilac-200/40" />
          <span className="decor-anim absolute size-24 animate-listen rounded-full border border-lilac-200/30 [animation-delay:0.9s]" />
          <span className="decor-anim absolute size-24 animate-listen rounded-full border border-mist-300/25 [animation-delay:1.8s]" />
        </>
      ) : (
        <>
          <span className="decor-anim absolute size-36 animate-orbit rounded-full border border-dashed border-lilac-300/25" />
          <span className="decor-anim absolute size-28 animate-orbit rounded-full border border-mist-300/20 [animation-direction:reverse] [animation-duration:11s]">
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-mist-300 shadow-[0_0_12px_rgb(167_220_230/0.9)]" />
          </span>
        </>
      )}
      <div
        className={cn("relative size-20 rounded-full", variant === "create" ? "decor-anim animate-breathe" : "decor-anim animate-float")}
        style={{
          background: "radial-gradient(circle at 32% 26%, #f6f3ff 0%, #cdbfff 24%, #9a87f2 55%, #4f3cb8 85%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.6), 0 18px 60px -10px rgb(140 120 255 / 0.65)",
        }}
      />
    </div>
  );
}
