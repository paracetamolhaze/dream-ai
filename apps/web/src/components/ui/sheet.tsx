"use client";

import { Dialog, VisuallyHidden } from "radix-ui";
import { X } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Hide the visible title (kept for screen readers). */
  hideTitle?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Prevent closing by overlay/escape while busy (e.g. payment in progress). */
  dismissible?: boolean;
}

/** Bottom sheet built on Radix Dialog (focus trap, escape, aria). */
export function Sheet({ open, onOpenChange, title, description, hideTitle, children, footer, className, dismissible = true }: SheetProps) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={(v) => (dismissible || v ? onOpenChange(v) : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(3_3_8/0.66)] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[min(88dvh,calc(var(--tg-viewport-height,100dvh)-24px))] w-full max-w-[560px] flex-col rounded-t-[28px] border-t border-white/[0.08] bg-night-850 shadow-[0_-30px_80px_-20px_rgb(0_0_0/0.8)] outline-none data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in",
            className,
          )}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
        >
          <div className="hairline-top relative flex shrink-0 flex-col items-center px-5 pt-2.5">
            <span className="h-1 w-10 rounded-full bg-white/15" aria-hidden />
            <div className={cn("flex w-full items-start justify-between gap-3 pt-4", hideTitle && "pt-1")}>
              {hideTitle ? (
                <VisuallyHidden.Root>
                  <Dialog.Title>{title}</Dialog.Title>
                </VisuallyHidden.Root>
              ) : (
                <div className="min-w-0">
                  <Dialog.Title className="font-display text-[26px] leading-[1.1] font-medium text-fg">{title}</Dialog.Title>
                  {description ? <Dialog.Description className="mt-1.5 text-[14px] leading-relaxed text-fg-muted">{description}</Dialog.Description> : null}
                </div>
              )}
              {!hideTitle && dismissible ? (
                <Dialog.Close className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-full text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg" aria-label={t.common.close}>
                  <X className="size-5" />
                </Dialog.Close>
              ) : null}
            </div>
            {hideTitle && description ? (
              <VisuallyHidden.Root>
                <Dialog.Description>{description}</Dialog.Description>
              </VisuallyHidden.Root>
            ) : null}
            {!description && !hideTitle ? (
              <VisuallyHidden.Root>
                <Dialog.Description>{title}</Dialog.Description>
              </VisuallyHidden.Root>
            ) : null}
          </div>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-5">{children}</div>
          {footer ? <div className="shrink-0 border-t border-white/[0.06] px-5 pt-3 pb-[calc(var(--app-bottom)+16px)]">{footer}</div> : <div className="shrink-0 pb-[var(--app-bottom)]" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
