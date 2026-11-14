"use client";

import { useState } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "danger";
  /** Optional word the user must type to enable the confirm button. */
  requireWord?: string;
  requirePrompt?: string;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, tone = "default", requireWord, requirePrompt, onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const locked = Boolean(requireWord) && typed.trim().toUpperCase() !== requireWord?.toUpperCase();

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (!v) setTyped("");
        onOpenChange(v);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-[rgb(3_3_8/0.7)] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(92vw,400px)] rounded-[26px] border border-white/[0.08] bg-night-850 p-6 shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)] outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in">
          <AlertDialog.Title className="font-display text-[26px] leading-tight font-medium">{title}</AlertDialog.Title>
          {description ? <AlertDialog.Description className="mt-2 text-[14px] leading-relaxed text-fg-muted">{description}</AlertDialog.Description> : <AlertDialog.Description className="sr-only">{title}</AlertDialog.Description>}
          {requireWord ? (
            <label className="mt-5 block">
              <span className="text-[13px] text-fg-muted">{requirePrompt}</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="mt-2 h-12 w-full rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 text-[16px] tracking-wide text-fg outline-none placeholder:text-fg-dim focus:border-rose-300/40"
                placeholder={requireWord}
              />
            </label>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={busy} block>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              className={cn(tone === "danger" && "border-rose-400/35 bg-rose-400/15")}
              block
              loading={busy}
              disabled={locked}
              haptics="medium"
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setTyped("");
                  onOpenChange(false);
                } catch {
                  /* the caller surfaces the error (toast); keep the dialog open */
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
