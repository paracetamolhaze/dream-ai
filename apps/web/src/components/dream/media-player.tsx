"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, RefreshCw, VideoOff } from "lucide-react";
import type { MediaDto } from "@dream/core/dto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/controls";
import { useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function enterFullscreen(v: FullscreenVideo) {
  try {
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
    else v.webkitEnterFullscreen?.();
  } catch {
    /* not supported */
  }
}

/**
 * Large 9:16 player for slideshows and AI videos. Missing/expired files show a
 * clear error state with a refresh (signed URLs are re-issued by refetching).
 */
export function MediaPlayer({ media, onReload, playSignal, className }: { media: MediaDto; onReload: () => void; playSignal?: number; className?: string }) {
  const t = useT();
  const ref = useRef<FullscreenVideo>(null);
  // Signed URLs rotate while the page polls; changing <video src> would restart playback.
  // Keep the first URL for this media until it fails or the user reloads.
  const [stable, setStable] = useState<{ id: string; url: string | null }>({ id: media.id, url: media.url });
  if (stable.id !== media.id || (!stable.url && media.url)) setStable({ id: media.id, url: media.url });
  const src = stable.id === media.id && stable.url ? stable.url : media.url;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === src;
  const opened = useRef(false);

  useEffect(() => {
    if (!playSignal) return;
    const v = ref.current;
    if (!v) return;
    void v.play().catch(() => undefined);
    enterFullscreen(v);
  }, [playSignal]);

  return (
    <div className={cn("relative mx-auto aspect-[9/16] w-full max-w-[min(420px,42vh)] overflow-hidden rounded-[28px] border border-white/[0.08] bg-black shadow-[0_40px_90px_-40px_rgb(150_128_255/0.55)]", className)}>
      {!src || failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-night-900 px-6 text-center">
          <VideoOff className="size-8 text-fg-dim" strokeWidth={1.5} aria-hidden />
          <p className="font-display text-[22px] text-fg">{t.dream.mediaUnavailable}</p>
          <p className="text-[13px] leading-relaxed text-fg-muted">{t.dream.mediaUnavailableText}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFailedUrl(null);
              setStable({ id: media.id, url: null });
              onReload();
            }}
          >
            <RefreshCw />
            {t.dream.reload}
          </Button>
        </div>
      ) : (
        <>
          <video
            key={media.id}
            ref={ref}
            src={src ?? undefined}
            poster={media.thumbUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            className="h-full w-full bg-black object-contain"
            onError={() => setFailedUrl(src)}
            onPlay={() => {
              if (!opened.current) {
                opened.current = true;
                trackEvent("result_opened", { type: media.type });
              }
            }}
          />
          <button
            type="button"
            onClick={() => ref.current && enterFullscreen(ref.current)}
            className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition-opacity hover:bg-black/60"
            aria-label={t.dream.fullscreen}
          >
            <Maximize2 className="size-4" />
          </button>
          {media.isDemo ? (
            <span className="pointer-events-none absolute top-3 left-3">
              <Badge tone="demo">{t.common.demo}</Badge>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
