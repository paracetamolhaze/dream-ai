"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

export function MenuGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass divide-y divide-white/[0.05] overflow-hidden rounded-[24px]", className)}>{children}</div>;
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value?: React.ReactNode;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  tone?: "default" | "danger";
  trailing?: React.ReactNode;
}

export function MenuItem({ icon, label, hint, value, href, onClick, tone = "default", trailing, external }: ItemProps) {
  const body = (
    <>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-[12px] [&_svg]:size-[18px]", tone === "danger" ? "bg-rose-400/10 text-rose-300" : "bg-white/[0.06] text-lilac-200")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-medium", tone === "danger" ? "text-rose-300" : "text-fg")}>{label}</span>
        {hint ? <span className="block truncate text-[12.5px] text-fg-dim">{hint}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-[14px] text-fg-muted">{value}</span> : null}
      {trailing ?? (href || onClick ? <ChevronRight className="size-[18px] shrink-0 text-fg-dim" aria-hidden /> : null)}
    </>
  );
  const cls = "flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.025] active:bg-white/[0.04]";
  if (href && !external) {
    return (
      <Link href={href} className={cls} onClick={() => haptic.select()}>
        {body}
      </Link>
    );
  }
  if (href && external) {
    return (
      <a href={href} className={cls} onClick={() => haptic.select()}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => {
          haptic.select();
          onClick();
        }}
      >
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}
