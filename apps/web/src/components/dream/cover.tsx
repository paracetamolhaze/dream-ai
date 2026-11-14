"use client";

import { useState } from "react";
import { hashString, cn } from "@/lib/utils";

const PALETTES = [
  ["#1b1f4a", "#4b3aa0", "#a596f2"],
  ["#0f2a36", "#2f6f86", "#a7dce6"],
  ["#2a1636", "#6d3b78", "#e0a9d8"],
  ["#161b33", "#3c4f8f", "#c7b9ff"],
  ["#1d1530", "#5a3f8c", "#f2c9a5"],
  ["#0c1f2a", "#3b5e7a", "#d8cfff"],
];

/**
 * Deterministic generative placeholder for a dream without a cover yet —
 * clearly decorative (no fake "result" imagery): soft gradient sky + moon orb.
 */
export function DreamPlaceholder({ seed, className, children }: { seed: string; className?: string; children?: React.ReactNode }) {
  const h = hashString(seed);
  const p = PALETTES[h % PALETTES.length]!;
  const x = 25 + (h % 50);
  const y = 18 + ((h >> 5) % 30);
  const size = 22 + ((h >> 9) % 18);
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        background: `radial-gradient(120% 80% at ${x}% ${y}%, ${p[1]}cc 0%, transparent 60%), linear-gradient(180deg, ${p[0]} 0%, #07080f 100%)`,
      }}
      aria-hidden
    >
      <div
        className="absolute rounded-full"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          width: `${size}%`,
          aspectRatio: "1",
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle at 35% 30%, #fff 0%, ${p[2]} 40%, ${p[1]} 75%, transparent 100%)`,
          boxShadow: `0 0 60px 10px ${p[2]}55`,
          opacity: 0.85,
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgb(5_6_12/0.55))]" />
      <div
        className="absolute inset-x-[-10%] bottom-[18%] h-[22%] opacity-40 blur-[18px]"
        style={{ background: `linear-gradient(90deg, transparent, ${p[2]}66, transparent)` }}
      />
      {children}
    </div>
  );
}

/** Image with graceful fallback to the placeholder when the URL fails. */
export function CoverImage({ src, seed, alt, className, imgClassName }: { src: string | null | undefined; seed: string; alt: string; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <DreamPlaceholder seed={seed} className={className} />;
  return (
    <div className={cn("relative overflow-hidden bg-night-800", className)}>
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn("h-full w-full object-cover", imgClassName)} />
    </div>
  );
}
