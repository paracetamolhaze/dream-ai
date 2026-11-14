"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Sparkles } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { CoverImage } from "@/components/dream/cover";
import { cardHref } from "@/components/dream/dream-card";
import { useMe, useSession } from "@/components/providers/session";
import { RecorderPanel } from "@/components/record/recorder-panel";
import { Badge } from "@/components/ui/controls";
import { useLocale, useT } from "@/i18n";
import { dayPart, formatShortDate } from "@/lib/format";
import { qk, useLibrary } from "@/lib/queries";
import type { RecorderStatus } from "@/lib/recorder";
import { uploadVoice } from "@/lib/voice";

export default function HomePage() {
  const t = useT();
  const [locale] = useLocale();
  const me = useMe();
  const { demoMode } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [recStatus, setRecStatus] = useState<RecorderStatus | "uploading">("idle");
  const onStatusChange = useCallback((s: RecorderStatus | "uploading") => setRecStatus(s), []);
  const greeting = useMemo(() => `${t.greeting[dayPart()]} 🌙`, [t]);
  const recent = useLibrary({ tab: "all", sort: "new", favorites: false, status: null, q: "" });
  const recentItems = recent.data?.pages[0]?.items.slice(0, 8) ?? [];
  const calm = recStatus === "idle" || recStatus === "error";

  return (
    <div className="flex min-h-app flex-col pb-nav">
      <header className="safe-top flex items-center justify-between px-5">
        <Logo name={me.appName} />
        <Link
          href="/profile/balance"
          className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-fg transition-transform active:scale-95"
          aria-label={t.profile.menu.balance}
        >
          <Sparkles className="size-4 text-gold-300" aria-hidden />
          {me.balance > 0 || me.freeSlideshowsLeft === 0 ? t.common.creditsShort(me.balance) : t.prepare.freeLeft(me.freeSlideshowsLeft)}
        </Link>
      </header>

      {demoMode ? (
        <div className="mt-3 flex justify-center px-5">
          <Badge tone="demo">{t.home.demoBanner}</Badge>
        </div>
      ) : null}

      <section className="flex flex-1 flex-col items-center justify-center px-5 pt-4 pb-2">
        <RecorderPanel
          variant="hero"
          onStatusChange={onStatusChange}
          submitLabel={t.home.send}
          idleHeader={
            <div className="mx-auto max-w-[360px] text-center">
              <p className="text-[15px] font-medium text-fg-muted">{greeting}</p>
              <h1 className="mt-3 font-display text-[44px] leading-[1.02] font-medium text-balance text-fg [@media(max-width:360px)]:text-[38px]">
                {t.home.titleBefore}
                <em className="text-lilac-glow pr-1 italic">{t.home.titleAccent}</em>
                {t.home.titleAfter}
              </h1>
              <p className="mx-auto mt-4 max-w-[310px] text-[15px] leading-relaxed text-fg-muted">{t.home.subtitle}</p>
            </div>
          }
          onWriteInstead={() => router.push("/write")}
          onSubmit={async (rec, onProgress) => {
            const res = await uploadVoice("/api/dreams/voice", rec, onProgress);
            qc.setQueryData(qk.dream(res.dream.id), res.dream);
            void qc.invalidateQueries({ queryKey: qk.libraryAll });
            router.push(`/dreams/${res.dream.id}/review`);
          }}
        />
      </section>

      <AnimatePresence>
        {calm && recentItems.length > 0 ? (
          <motion.section
            key="recent"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6"
            aria-label={t.home.recentTitle}
          >
            <div className="mb-3 flex items-center justify-between px-5">
              <h2 className="text-[12px] font-semibold tracking-[0.14em] text-fg-dim uppercase">{t.home.recentTitle}</h2>
              <Link href="/dreams" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-lilac-300">
                {t.home.seeAll}
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
            <ul className="no-scrollbar fade-x flex snap-x gap-3 overflow-x-auto px-5 pb-1">
              {recentItems.map((item) => (
                <li key={item.id} className="w-[112px] shrink-0 snap-start">
                  <Link href={cardHref(item)} className="block transition-transform active:scale-[0.97]">
                    <CoverImage src={item.cover?.thumbUrl ?? item.cover?.url} seed={item.id} alt={item.title ?? t.library.untitled} className="aspect-[3/4] rounded-[18px] border border-white/[0.07]" />
                    <p className="mt-2 line-clamp-1 text-[13px] font-semibold text-fg">{item.title ?? t.library.untitled}</p>
                    <p className="text-[11.5px] text-fg-dim">{formatShortDate(item.createdAt, locale)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
