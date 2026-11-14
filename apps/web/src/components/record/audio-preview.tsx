"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useT } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

/**
 * Compact audio player for a recording. `knownDurationSec` is used because
 * MediaRecorder WebM blobs often report an infinite duration.
 */
type Props = { src: string; knownDurationSec?: number | null; className?: string; label?: string };

export function AudioPreview(props: Props) {
  return <AudioPreviewInner key={props.src} {...props} />;
}

function AudioPreviewInner({ src, knownDurationSec, className, label }: Props) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(knownDurationSec ?? 0);
  const [failed, setFailed] = useState(false);

  const total = duration > 0 && Number.isFinite(duration) ? duration : knownDurationSec ?? 0;
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className={cn("flex items-center gap-3.5 rounded-[22px] border border-white/[0.07] bg-white/[0.035] px-3.5 py-3", className)}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        disabled={failed}
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          haptic.impact("light");
          if (a.paused) void a.play().catch(() => setFailed(true));
          else a.pause();
        }}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-lilac-200 text-night-950 shadow-[0_8px_22px_-8px_rgb(150_128_255/0.7)] transition-transform active:scale-95 disabled:opacity-40"
        aria-label={playing ? t.common.pause : t.common.play}
      >
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        {label ? <div className="mb-0.5 truncate text-[12px] font-medium text-fg-dim">{label}</div> : null}
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={Math.min(current, total || 1)}
          onChange={(e) => {
            const a = audioRef.current;
            const v = Number(e.target.value);
            if (a && Number.isFinite(v)) {
              a.currentTime = v;
              setCurrent(v);
            }
          }}
          className="range-dream w-full"
          style={{ ["--progress" as string]: `${progress}%` }}
          aria-label={label ?? t.common.audio}
          disabled={failed || total <= 0}
        />
      </div>
      <span className="w-[42px] shrink-0 text-right text-[12px] text-fg-muted tabular-nums">{formatDuration(playing || current > 0 ? current : total)}</span>
    </div>
  );
}
