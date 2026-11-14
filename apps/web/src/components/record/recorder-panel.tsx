"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pause, PenLine, Play, RotateCcw, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { formatDuration } from "@/lib/format";
import { isRecorderSupported, useRecorder, type RecorderStatus, type RecordingResult } from "@/lib/recorder";
import { haptic, setClosingConfirmation } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { AudioPreview } from "./audio-preview";
import { RecordButton } from "./record-button";
import { VoiceFallbackSheet, type FallbackReason } from "./voice-fallback";
import { Waveform } from "./waveform";

const ease = [0.22, 1, 0.36, 1] as const;

export interface RecorderPanelProps {
  variant: "hero" | "compact";
  idleHeader?: React.ReactNode;
  submitLabel: string;
  onSubmit: (rec: RecordingResult, onProgress: (fraction: number) => void) => Promise<void>;
  onWriteInstead?: () => void;
  onStatusChange?: (s: RecorderStatus | "uploading") => void;
}

export function RecorderPanel({ variant, idleHeader, submitLabel, onSubmit, onWriteInstead, onStatusChange }: RecorderPanelProps) {
  const t = useT();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const rec = useRecorder({
    onAutoStop: () => toast.toast({ title: t.home.autoStopped }),
    onTooShort: () => toast.toast({ title: t.home.tooShort }),
    onRecorded: (r) => {
      haptic.notify("success");
      trackEvent("recording_completed", { sec: Math.round(r.durationMs / 1000) });
    },
    onError: (e) => {
      if (e === "denied") trackEvent("mic_denied");
      haptic.notify("warning");
    },
  });
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [manualFallback, setManualFallback] = useState<FallbackReason | null>(null);
  const compact = variant === "compact";
  const uploading = uploadProgress !== null;
  // Recorder errors open the fallback sheet; "unsupported" can also be raised before starting.
  const autoFallback: FallbackReason | null = rec.status === "error" && rec.error && rec.error !== "too-short" ? rec.error : null;
  const fallback = manualFallback ?? autoFallback;

  useEffect(() => {
    onStatusChange?.(uploading ? "uploading" : rec.status);
  }, [rec.status, uploading, onStatusChange]);

  // Don't let an accidental swipe/close lose an unsent recording.
  const unsaved = uploading || rec.status === "recording" || rec.status === "paused" || rec.status === "recorded";
  useEffect(() => {
    setClosingConfirmation(unsaved);
    return () => setClosingConfirmation(false);
  }, [unsaved]);

  async function pressMain() {
    if (rec.status === "recording" || rec.status === "paused") {
      haptic.impact("medium");
      rec.stop();
      return;
    }
    if (rec.status === "requesting") return;
    if (!isRecorderSupported()) {
      setManualFallback("unsupported");
      return;
    }
    haptic.impact("medium");
    trackEvent("start_recording");
    await rec.start();
  }

  async function submit() {
    if (!rec.result) return;
    setUploadProgress(0);
    try {
      await onSubmit(rec.result, (f) => setUploadProgress(f));
    } catch (err) {
      setUploadProgress(null);
      toast.error(errorMessage(err));
    }
  }

  async function pressMainAfterReset() {
    rec.reset();
    haptic.impact("medium");
    trackEvent("start_recording", { again: true });
    await rec.start();
  }

  const status = rec.status;
  const live = status === "recording" || status === "paused";
  const mode = uploading ? "busy" : status === "requesting" ? "requesting" : status === "recording" ? "recording" : status === "paused" ? "paused" : "idle";
  const remainingMs = rec.maxMs - rec.elapsedMs;
  const showButton = !(status === "recorded" || uploading);

  return (
    <div className={cn("flex w-full flex-col items-center", compact ? "gap-3" : "gap-2")}>
      {/* Header area swaps between hero text, live timer and the "ready" message. */}
      <div className={cn("relative flex w-full flex-col items-center justify-end text-center", compact ? "min-h-[64px]" : "min-h-[176px]")}>
        <AnimatePresence mode="wait" initial={false}>
          {live ? (
            <motion.div key="live" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease }} className="flex flex-col items-center">
              <span className={cn("font-display leading-none font-medium tabular-nums text-moon", compact ? "text-[46px]" : "text-[64px]")}>{formatDuration(rec.elapsedMs / 1000)}</span>
              <span className={cn("mt-2 text-[14px] font-medium", status === "paused" ? "text-amber-300" : "text-fg-muted")}>{status === "paused" ? t.home.paused : t.home.listening}</span>
            </motion.div>
          ) : status === "recorded" || uploading ? (
            <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease }} className="flex flex-col items-center">
              <span className={cn("font-display leading-tight font-medium text-moon", compact ? "text-[28px]" : "text-[38px]")}>{t.home.recordedTitle}</span>
              <span className="mt-1.5 text-[14px] text-fg-muted">{uploading ? t.home.uploading : t.home.recordedHint}</span>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease }} className="w-full">
              {idleHeader}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showButton ? (
        <div className={cn("relative", compact ? "-my-9 scale-[0.72]" : "my-1 [@media(max-height:720px)]:-my-6 [@media(max-height:720px)]:scale-[0.84]")}>
          <RecordButton mode={mode} levelRef={rec.levelRef} onPress={pressMain} label={live ? t.home.stop : t.home.tapToTell} />
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        {live ? (
          <motion.div key="controls" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }} className="flex w-full max-w-[360px] flex-col items-center gap-4">
            <Waveform barsRef={rec.barsRef} active={status === "recording"} dim={status === "paused"} className="h-12 w-full" />
            <div className="flex w-full items-center justify-between">
              <Button
                variant="secondary"
                size="icon"
                aria-label={t.home.cancel}
                onClick={() => {
                  rec.cancel();
                  trackEvent("recording_cancelled");
                }}
              >
                <X />
              </Button>
              <span className={cn("text-[12.5px] font-medium tabular-nums", remainingMs < 30_000 ? "text-amber-300" : "text-fg-dim")}>
                {remainingMs < 30_000 ? `−${formatDuration(remainingMs / 1000)}` : t.home.maxDuration(Math.round(rec.maxMs / 60_000))}
              </span>
              {rec.canPause ? (
                <Button variant="secondary" size="icon" aria-label={status === "paused" ? t.home.resume : t.home.pause} onClick={() => (status === "paused" ? rec.resume() : rec.pause())}>
                  {status === "paused" ? <Play className="fill-current" /> : <Pause className="fill-current" />}
                </Button>
              ) : (
                <span className="size-11" aria-hidden />
              )}
            </div>
          </motion.div>
        ) : status === "recorded" && rec.result ? (
          <motion.div key="recorded" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }} className="flex w-full max-w-[400px] flex-col gap-3">
            {uploading ? (
              <div className="glass flex flex-col gap-3 rounded-[22px] px-5 py-5">
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-fg">{t.home.uploading}</span>
                  <span className="text-fg-muted tabular-nums">{Math.round((uploadProgress ?? 0) * 100)}%</span>
                </div>
                <ProgressBar value={(uploadProgress ?? 0) * 100} indeterminate={(uploadProgress ?? 0) >= 0.999} />
              </div>
            ) : (
              <>
                <AudioPreview src={rec.result.url} knownDurationSec={rec.result.durationMs / 1000} />
                <Button size="lg" block onClick={submit} haptics="medium">
                  <Send />
                  {submitLabel}
                </Button>
                <div className="flex gap-2.5">
                  <Button variant="secondary" block onClick={() => void pressMainAfterReset()}>
                    <RotateCcw />
                    {t.home.rerecord}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t.home.discard} onClick={() => rec.reset()}>
                    <Trash2 />
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        ) : status !== "requesting" ? (
          <motion.div key="idle-cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-4">
            <p className="text-[14.5px] font-medium text-fg-muted">{t.home.tapToTell}</p>
            {onWriteInstead ? (
              <Button
                variant="secondary"
                onClick={() => {
                  trackEvent("text_mode_opened");
                  onWriteInstead();
                }}
              >
                <PenLine />
                {t.home.writeInstead}
              </Button>
            ) : null}
          </motion.div>
        ) : (
          <motion.p key="req" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[14.5px] text-fg-muted">
            {t.home.requesting}
          </motion.p>
        )}
      </AnimatePresence>

      <VoiceFallbackSheet
        reason={fallback}
        onOpenChange={(open) => {
          if (!open) {
            setManualFallback(null);
            if (rec.status === "error") rec.reset();
          }
        }}
        onRetry={() => {
          setManualFallback(null);
          rec.reset();
          void pressMain();
        }}
        onWriteInstead={
          onWriteInstead
            ? () => {
                setManualFallback(null);
                rec.reset();
                onWriteInstead();
              }
            : undefined
        }
      />
    </div>
  );

}
