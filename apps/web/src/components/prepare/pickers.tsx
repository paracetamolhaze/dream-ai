"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Music2, Pause, Play, Upload, VolumeX } from "lucide-react";
import type { MusicTrackDto, StyleDto, VideoDurationOptionDto } from "@dream/core/dto";
import { Spinner } from "@/components/ui/controls";
import { useT } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

// ─── Style ──────────────────────────────────────────────────────────────────

export function StylePicker({ styles, value, onChange }: { styles: StyleDto[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t.prepare.style} className="no-scrollbar fade-x -mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
      {styles.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              haptic.select();
              onChange(s.id);
            }}
            className={cn(
              "flex shrink-0 flex-col items-center gap-2 rounded-[20px] border p-2 pb-2.5 transition-colors",
              active ? "border-lilac-300/50 bg-lilac-400/[0.1]" : "border-white/[0.06] bg-white/[0.025]",
            )}
          >
            <span className="relative block h-[72px] w-[60px] overflow-hidden rounded-[14px]" style={{ background: s.swatch }}>
              <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgb(255_255_255/0.35),transparent_55%)]" />
              {active ? (
                <span className="absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-lilac-100 text-night-950">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
              ) : null}
            </span>
            <span className={cn("max-w-[72px] truncate text-[12px] font-semibold", active ? "text-fg" : "text-fg-muted")}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Video duration ─────────────────────────────────────────────────────────

export function DurationPicker({ options, value, onChange }: { options: VideoDurationOptionDto[]; value: number | null; onChange: (targetSec: number) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t.prepare.duration} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {options.map((o) => {
        const active = o.targetSec === value;
        return (
          <button
            key={o.targetSec}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              haptic.select();
              onChange(o.targetSec);
            }}
            className={cn(
              "flex flex-col items-start rounded-[20px] border px-4 py-3 text-left transition-colors",
              active ? "border-lilac-300/50 bg-lilac-400/[0.1]" : "border-white/[0.06] bg-white/[0.025]",
            )}
          >
            <span className="font-display text-[26px] leading-none font-medium text-fg">{t.prepare.durationOption(o.actualSec)}</span>
            <span className="mt-1.5 text-[12px] text-fg-muted">{t.prepare.clipsInfo(o.clips)}</span>
            <span className={cn("mt-2 text-[13px] font-bold", active ? "text-lilac-100" : "text-fg")}>{t.common.creditsShort(o.credits)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Music ──────────────────────────────────────────────────────────────────

export function MusicPicker({ tracks, value, onChange, onUpload, uploading }: { tracks: MusicTrackDto[]; value: string | null; onChange: (id: string | null) => void; onUpload: (file: File) => void; uploading: boolean }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  function togglePreview(track: MusicTrackDto) {
    if (!track.previewUrl) return;
    haptic.impact("light");
    if (playing === track.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(track.previewUrl);
    a.volume = 0.8;
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    audioRef.current = a;
    void a.play().then(
      () => setPlaying(track.id),
      () => setPlaying(null),
    );
  }

  const rows: { id: string | null; title: string; sub: string | null; track?: MusicTrackDto }[] = [
    { id: null, title: t.prepare.noMusic, sub: null },
    ...tracks.map((tr) => ({
      id: tr.id,
      title: tr.title,
      sub: [tr.isOwn ? t.prepare.ownTrack : tr.isGenerated ? t.prepare.generatedTrack : tr.artist, tr.durationSec ? formatDuration(tr.durationSec) : null].filter(Boolean).join(" · ") || null,
      track: tr,
    })),
  ];

  return (
    <div className="overflow-hidden rounded-[22px] border border-white/[0.06] bg-white/[0.025]" role="radiogroup" aria-label={t.prepare.music}>
      {rows.map((r, i) => {
        const active = r.id === value;
        return (
          <div key={r.id ?? "none"} className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-white/[0.05]", active && "bg-lilac-400/[0.07]")}>
            {r.track ? (
              <button
                type="button"
                onClick={() => togglePreview(r.track!)}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-fg transition-colors hover:bg-white/[0.1]"
                aria-label={playing === r.id ? t.common.pause : t.common.play}
              >
                {playing === r.id ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
              </button>
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.04] text-fg-dim" aria-hidden>
                <VolumeX className="size-4" />
              </span>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                haptic.select();
                onChange(r.id);
              }}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 py-1 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-fg">{r.title}</span>
                {r.sub ? <span className="block truncate text-[12px] text-fg-dim">{r.sub}</span> : null}
              </span>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", active ? "border-lilac-200 bg-lilac-200 text-night-950" : "border-white/20")} aria-hidden>
                {active ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
            </button>
          </div>
        );
      })}
      <div className="border-t border-white/[0.05] px-3.5 py-3">
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/webm,audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(f);
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 text-left text-[14px] font-semibold text-lilac-200 disabled:opacity-60"
        >
          <span className="grid size-9 place-items-center rounded-full bg-lilac-400/10">{uploading ? <Spinner className="size-4" /> : <Upload className="size-4" />}</span>
          <span className="min-w-0">
            <span className="block">{uploading ? t.prepare.uploadingMusic : t.prepare.uploadMusic}</span>
            <span className="block text-[12px] font-normal text-fg-dim">{t.prepare.musicRights}</span>
          </span>
          <Music2 className="ml-auto size-4 text-fg-dim" aria-hidden />
        </button>
      </div>
    </div>
  );
}
