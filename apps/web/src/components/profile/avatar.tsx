"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function Avatar({ src, name, className }: { src: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "☾";
  return (
    <div className={cn("relative size-[72px] shrink-0 overflow-hidden rounded-full border border-white/10 shadow-[0_12px_40px_-12px_rgb(150_128_255/0.6)]", className)}>
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} referrerPolicy="no-referrer" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_25%,#ded5ff,#7a66df_60%,#221a57)] font-display text-[28px] font-medium text-night-950">{initials}</div>
      )}
    </div>
  );
}
