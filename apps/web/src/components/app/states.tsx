"use client";

import { motion } from "motion/react";
import { CloudOff, MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";

export function EmptyState({ icon, title, text, action, className }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col items-center px-6 py-14 text-center", className)}
    >
      <div className="relative mb-6 grid size-20 place-items-center">
        <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.28),transparent)]" />
        <div className="relative grid size-16 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-lilac-200">{icon ?? <MoonStar className="size-7" strokeWidth={1.5} />}</div>
      </div>
      <h3 className="font-display text-[28px] leading-tight font-medium text-fg">{title}</h3>
      {text ? <p className="mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-fg-muted">{text}</p> : null}
      {action ? <div className="mt-7">{action}</div> : null}
    </motion.div>
  );
}

export function ErrorState({ title, text, onRetry, retryLabel, className }: { title: string; text?: string; onRetry?: () => void; retryLabel?: string; className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={<CloudOff className="size-7" strokeWidth={1.5} />}
      title={title}
      text={text}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Full-screen centered message used by the session gate. */
export function FullScreenMessage({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-app flex-col items-center justify-center px-8 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="relative mb-8 grid size-28 place-items-center">
        <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.35),transparent)]" />
        <LogoMark className="relative size-16" />
      </motion.div>
      <h1 className="font-display text-[34px] leading-[1.08] font-medium text-moon">{title}</h1>
      <p className="mt-3 max-w-[320px] text-[15px] leading-relaxed text-fg-muted">{text}</p>
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}

/** Launch splash. `hint` fades in only if loading takes noticeably long, so a slow network never looks frozen. */
export function Splash({ hint }: { hint?: string }) {
  return (
    <div className="relative z-10 flex min-h-app flex-col items-center justify-center" aria-busy>
      <div className="relative grid size-32 place-items-center">
        <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.4),transparent)]" />
        <div className="decor-anim absolute inset-3 animate-orbit rounded-full border border-dashed border-lilac-300/20" />
        <LogoMark className="relative size-14 animate-float" />
      </div>
      {hint ? (
        <p role="status" className="mt-6 animate-fade-in text-[13.5px] tracking-wide text-fg-muted [animation-delay:3.5s]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
