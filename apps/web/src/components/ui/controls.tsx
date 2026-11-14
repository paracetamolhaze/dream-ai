"use client";

import { forwardRef, useId } from "react";
import { Switch as RadixSwitch } from "radix-ui";
import { motion } from "motion/react";
import { LoaderCircle } from "lucide-react";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

// ─── Switch ─────────────────────────────────────────────────────────────────

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <RadixSwitch.Root
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(v) => {
        haptic.select();
        onCheckedChange(v);
      }}
      className="relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full border border-white/[0.08] bg-white/[0.08] transition-colors duration-200 data-[state=checked]:border-lilac-300/40 data-[state=checked]:bg-lilac-500/70 disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block size-6 translate-x-[2px] rounded-full bg-fg shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-transform duration-200 ease-out data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  );
}

// ─── Segmented control ──────────────────────────────────────────────────────

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md", label }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; className?: string; size?: "sm" | "md"; label: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative flex rounded-full border border-white/[0.07] bg-white/[0.035] p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) {
                haptic.select();
                onChange(o.value);
              }
            }}
            className={cn(
              "relative z-10 flex-1 rounded-full font-semibold transition-colors duration-200",
              size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-3 text-[13.5px]",
              active ? "text-night-950" : "text-fg-muted hover:text-fg",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-[linear-gradient(135deg,#ece6ff,#c3b6fd)] shadow-[0_6px_18px_-8px_rgb(150_128_255/0.7)]"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Chip (toggle pill) ─────────────────────────────────────────────────────

export const Chip = forwardRef<HTMLButtonElement, { active?: boolean; children: React.ReactNode; onClick?: () => void; className?: string; icon?: React.ReactNode; ariaLabel?: string }>(function Chip(
  { active, children, onClick, className, icon, ariaLabel },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={() => {
        haptic.select();
        onClick?.();
      }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-200",
        active ? "border-lilac-300/40 bg-lilac-400/15 text-lilac-100" : "border-white/[0.07] bg-white/[0.03] text-fg-muted hover:text-fg",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
});

// ─── Misc ───────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-5 animate-spin text-lilac-300", className)} aria-hidden />;
}

export function ProgressBar({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  return (
    <div
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
    >
      {indeterminate ? (
        <div className="decor-anim absolute inset-y-0 left-0 w-1/3 animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,#c7b9ff,transparent)]" />
      ) : (
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#8f7cf2,#c7b9ff_70%,#a7dce6)] shadow-[0_0_14px_rgb(174_156_251/0.6)] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

export function Badge({ children, tone = "default", className }: { children: React.ReactNode; tone?: "default" | "lilac" | "gold" | "mint" | "rose" | "demo"; className?: string }) {
  const tones = {
    default: "border-white/[0.08] bg-white/[0.06] text-fg-muted",
    lilac: "border-lilac-300/25 bg-lilac-400/12 text-lilac-200",
    gold: "border-gold-300/25 bg-gold-400/12 text-gold-200",
    mint: "border-mint-300/25 bg-mint-400/10 text-mint-300",
    rose: "border-rose-300/25 bg-rose-400/10 text-rose-300",
    demo: "border-amber-300/30 bg-amber-300/10 text-amber-300 tracking-[0.08em]",
  } as const;
  return <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, as: As = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "section" | "li" }) {
  return <As className={cn("glass rounded-[24px]", className)}>{children}</As>;
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[12px] font-semibold tracking-[0.14em] text-fg-dim uppercase">{children}</h2>
      {action}
    </div>
  );
}
