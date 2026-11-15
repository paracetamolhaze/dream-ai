"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Library, MoonStar, User } from "lucide-react";
import { useT } from "@/i18n";
import { getWebApp, haptic, supports } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { routes } from "@dream/core/routes";

const TAB_ROOTS = ["/", "/dreams", "/profile"];

function parentPath(pathname: string): string {
  // Read at click time (no useSearchParams in the layout — keeps the static export happy).
  const id = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("id") : null;
  if (pathname === "/dream/job" && id) return routes.dream(id);
  if (pathname === "/dream" || pathname === "/dream/review" || pathname === "/dream/prepare") return routes.library;
  if (pathname.startsWith("/profile/")) return routes.profile;
  return routes.home;
}

/** Shows Telegram's native BackButton on pushed screens. */
function useTelegramBackButton(visible: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  useEffect(() => {
    cb.current = onBack;
  });
  useEffect(() => {
    const wa = getWebApp();
    if (!wa || !supports("6.1")) return;
    const handler = () => cb.current();
    try {
      if (visible) {
        wa.BackButton.show();
        wa.BackButton.onClick(handler);
      } else {
        wa.BackButton.hide();
      }
    } catch {
      /* ignore */
    }
    return () => {
      try {
        wa.BackButton.offClick(handler);
      } catch {
        /* ignore */
      }
    };
  }, [visible]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isRoot = TAB_ROOTS.includes(pathname);
  // In-app navigation stack: window.history.length can't tell whether "back" stays inside
  // the app (e.g. after a deep-link launch the first entry is the deep-linked page).
  const stack = useRef<string[]>([]);
  useEffect(() => {
    const s = stack.current;
    if (s.length >= 2 && s[s.length - 2] === pathname) s.pop();
    else if (s[s.length - 1] !== pathname) s.push(pathname);
  }, [pathname]);

  useTelegramBackButton(!isRoot, () => {
    haptic.impact("light");
    if (stack.current.length > 1) router.back();
    else router.replace(parentPath(pathname));
  });

  return (
    <>
      <main className="relative z-10 mx-auto min-h-app w-full max-w-[560px]">{children}</main>
      <AnimatePresence>{isRoot ? <BottomNav key="nav" pathname={pathname} /> : null}</AnimatePresence>
    </>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const t = useT();
  const tabs = [
    { href: "/", label: t.nav.home, Icon: MoonStar },
    { href: "/dreams", label: t.nav.dreams, Icon: Library },
    { href: "/profile", label: t.nav.profile, Icon: User },
  ];
  return (
    <motion.nav
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(var(--app-bottom)+10px)]"
      aria-label={t.nav.label}
    >
      <div className="glass-strong pointer-events-auto mx-auto flex h-[var(--nav-height)] max-w-[420px] items-center gap-1 rounded-[26px] px-1.5">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              prefetch
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (!active) haptic.select();
              }}
              className="relative flex h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-[20px]"
            >
              {active ? (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-[20px] border border-lilac-300/15 bg-[linear-gradient(180deg,rgb(174_156_251/0.16),rgb(174_156_251/0.06))]"
                  transition={{ type: "spring", stiffness: 420, damping: 38 }}
                />
              ) : null}
              <Icon className={cn("relative size-[21px] transition-colors duration-200", active ? "text-lilac-100" : "text-fg-dim")} strokeWidth={active ? 2 : 1.7} aria-hidden />
              <span className={cn("relative text-[11px] font-semibold tracking-[0.01em] transition-colors duration-200", active ? "text-fg" : "text-fg-dim")}>{label}</span>
            </Link>
          );
        })}
      </div>
    </motion.nav>
  );
}
