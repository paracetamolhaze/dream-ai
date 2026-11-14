"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useT } from "@/i18n";
import { isInTelegram } from "@/lib/telegram";
import { useMounted } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Header for pushed screens. Inside Telegram navigation back uses the native
 * BackButton (see AppShell); in a regular browser an in-app back arrow is shown.
 */
export function PageHeader({ title, subtitle, right, backHref, className, large = false }: { title?: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; backHref?: string; className?: string; large?: boolean }) {
  const t = useT();
  const router = useRouter();
  const mounted = useMounted();
  const showBack = mounted && !isInTelegram() && Boolean(backHref);
  return (
    <header className={cn("safe-top px-5", className)}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {showBack ? (
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? router.back() : router.push(backHref!))}
              className="-ml-2 grid size-10 place-items-center rounded-full text-fg-muted transition-colors hover:bg-white/[0.05] hover:text-fg"
              aria-label={t.common.back}
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          {title && !large ? <h1 className="truncate text-[17px] font-semibold text-fg">{title}</h1> : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
      </div>
      {title && large ? (
        <div className="mt-3">
          <h1 className="font-display text-[38px] leading-[1.05] font-medium text-moon">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-[14.5px] text-fg-muted">{subtitle}</p> : null}
        </div>
      ) : null}
    </header>
  );
}
