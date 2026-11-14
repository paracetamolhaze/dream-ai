"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "idle" | "requesting" | "recording" | "paused" | "busy";

/**
 * The glowing moon button. While recording, its halo rings and glow follow
 * the real microphone level (read from `levelRef` in a rAF loop, no re-renders).
 */
export function RecordButton({ mode, levelRef, onPress, label, disabled }: { mode: Mode; levelRef: React.RefObject<number>; onPress: () => void; label: string; disabled?: boolean }) {
  const glowRef = useRef<HTMLDivElement>(null);
  const ring1 = useRef<HTMLSpanElement>(null);
  const ring2 = useRef<HTMLSpanElement>(null);
  const ring3 = useRef<HTMLSpanElement>(null);
  const live = mode === "recording";

  useEffect(() => {
    if (!live) {
      for (const el of [glowRef.current, ring1.current, ring2.current, ring3.current]) {
        if (el) {
          el.style.transform = "";
          el.style.opacity = "";
        }
      }
      return;
    }
    let raf = 0;
    const loop = () => {
      const l = Math.min(1, Math.max(0, levelRef.current ?? 0));
      if (glowRef.current) {
        glowRef.current.style.transform = `scale(${1 + l * 0.35})`;
        glowRef.current.style.opacity = String(0.55 + l * 0.45);
      }
      if (ring1.current) {
        ring1.current.style.transform = `scale(${1 + l * 0.12})`;
        ring1.current.style.opacity = String(0.35 + l * 0.6);
      }
      if (ring2.current) {
        ring2.current.style.transform = `scale(${1 + l * 0.22})`;
        ring2.current.style.opacity = String(0.22 + l * 0.5);
      }
      if (ring3.current) {
        ring3.current.style.transform = `scale(${1 + l * 0.34})`;
        ring3.current.style.opacity = String(0.12 + l * 0.4);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, levelRef]);

  const idleAnim = mode === "idle" || mode === "paused";

  return (
    <div className="relative grid size-[260px] place-items-center select-none">
      {/* ambient moonlight */}
      <div
        ref={glowRef}
        className={cn(
          "absolute size-[230px] rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.42),rgb(120_100_240/0.12)_55%,transparent)] transition-[opacity] duration-500",
          idleAnim && "decor-anim animate-breathe",
          mode === "paused" && "opacity-50",
        )}
        aria-hidden
      />
      <span ref={ring3} className={cn("absolute size-[248px] rounded-full border border-lilac-300/10", idleAnim && "decor-anim animate-halo [animation-delay:1.2s]")} aria-hidden />
      <span ref={ring2} className={cn("absolute size-[214px] rounded-full border border-lilac-300/[0.16]", idleAnim && "decor-anim animate-halo [animation-delay:0.6s]")} aria-hidden />
      <span ref={ring1} className={cn("absolute size-[182px] rounded-full border border-lilac-200/20", idleAnim && "decor-anim animate-halo")} aria-hidden />
      {live ? <span className="decor-anim absolute size-[168px] animate-orbit rounded-full border border-dashed border-lilac-200/25" aria-hidden /> : null}

      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "relative grid size-[150px] place-items-center rounded-full outline-offset-8 transition-transform duration-300 ease-out active:scale-[0.96] disabled:opacity-60",
          mode === "idle" && "decor-anim animate-breathe",
        )}
        style={{
          background: live
            ? "radial-gradient(circle at 32% 26%, #fbf9ff 0%, #d8ceff 20%, #a593f6 50%, #6550d6 78%, #33257f 100%)"
            : "radial-gradient(circle at 32% 26%, #f4f0ff 0%, #cdbfff 22%, #9a87f2 52%, #5a45c9 80%, #2b2170 100%)",
          boxShadow:
            "inset 0 1px 0 rgb(255 255 255 / 0.55), inset 0 -14px 34px rgb(36 22 110 / 0.55), 0 24px 70px -14px rgb(140 120 255 / 0.65), 0 0 130px -24px rgb(120 100 240 / 0.6)",
        }}
      >
        {/* soft surface sheen */}
        <span className="pointer-events-none absolute inset-[10%] rounded-full bg-[radial-gradient(circle_at_35%_25%,rgb(255_255_255/0.35),transparent_55%)]" aria-hidden />
        {mode === "requesting" || mode === "busy" ? (
          <LoaderCircle className="relative size-11 animate-spin text-night-950/80" strokeWidth={1.8} aria-hidden />
        ) : mode === "recording" || mode === "paused" ? (
          <span className="relative size-10 rounded-[12px] bg-night-950/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]" aria-hidden />
        ) : (
          <Mic className="relative size-12 text-night-950/85" strokeWidth={1.6} aria-hidden />
        )}
      </button>
    </div>
  );
}
