import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Crescent moon mark + wordmark. Replace for rebranding. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <radialGradient id="logo-moon" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#f6f3ff" />
          <stop offset="0.5" stopColor="#bcaefc" />
          <stop offset="1" stopColor="#5b45cc" />
        </radialGradient>
      </defs>
      <path d="M20.6 5.2a11 11 0 1 0 6.2 19.9A9.2 9.2 0 0 1 20.6 5.2Z" fill="url(#logo-moon)" />
      <circle cx="24.4" cy="8.4" r="1.1" fill="#f1edff" />
      <circle cx="27.4" cy="13.6" r="0.7" fill="#a7dce6" />
    </svg>
  );
}

export function Logo({ name, className }: { name?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[13px] font-bold tracking-[0.22em] text-fg/90 uppercase">{name ?? brand.name}</span>
    </span>
  );
}
