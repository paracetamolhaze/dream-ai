"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Heart, Mic, Search, X } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/app/states";
import { DreamCard, DreamCardSkeleton } from "@/components/dream/dream-card";
import { Button } from "@/components/ui/button";
import { Chip, Segmented } from "@/components/ui/controls";
import { useErrorMessage, useLocale, useT } from "@/i18n";
import { trackEvent } from "@/lib/analytics";
import { formatNumber } from "@/lib/format";
import { useDebounced, useInView, useSessionState } from "@/lib/hooks";
import { useLibrary, type LibraryParams } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Tab = LibraryParams["tab"];

export default function LibraryPage() {
  const t = useT();
  const [locale] = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useSessionState<Tab>("dream.lib.tab", "all");
  const [sort, setSort] = useSessionState<"new" | "old">("dream.lib.sort", "new");
  const [favorites, setFavorites] = useSessionState("dream.lib.fav", false);
  const [status, setStatus] = useSessionState<"ready" | "processing" | null>("dream.lib.status", null);
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 350);

  useEffect(() => {
    trackEvent("library_opened");
  }, []);

  const params = useMemo<LibraryParams>(() => ({ tab, sort, favorites, status, q }), [tab, sort, favorites, status, q]);
  const lib = useLibrary(params);
  const items = useMemo(() => lib.data?.pages.flatMap((p) => p.items) ?? [], [lib.data]);
  const stats = lib.data?.pages[0]?.stats;
  const filtered = tab !== "all" || favorites || status !== null || q.trim() !== "";
  const sentinel = useInView<HTMLDivElement>(() => {
    if (lib.hasNextPage && !lib.isFetchingNextPage) void lib.fetchNextPage();
  }, Boolean(lib.hasNextPage));

  function changed(kind: string) {
    trackEvent("library_filter_changed", { kind });
  }

  function reset() {
    setTab("all");
    setFavorites(false);
    setStatus(null);
    setQuery("");
  }

  return (
    <div className="min-h-app pb-nav">
      <header className="safe-top px-5">
        <h1 className="pt-3 font-display text-[40px] leading-[1.02] font-medium text-moon">{t.library.title}</h1>
        <p className="mt-1.5 text-[15px] text-fg-muted">{t.library.subtitle}</p>

        <dl className="mt-5 grid grid-cols-3 gap-2.5">
          {(
            [
              ["total", stats?.total],
              ["slideshows", stats?.slideshows],
              ["videos", stats?.videos],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="glass rounded-[20px] px-3.5 py-3">
              <dt className="text-[11.5px] font-medium text-fg-dim">{t.library.stats[key]}</dt>
              <dd className="mt-1 font-display text-[28px] leading-none font-medium text-fg tabular-nums">{value === undefined ? "–" : formatNumber(value, locale)}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="sticky top-0 z-20 mt-5 bg-[linear-gradient(to_bottom,var(--color-night-950)_78%,transparent)] px-5 pt-[calc(var(--app-top)+8px)] pb-3">
        <Segmented
          label={t.library.title}
          value={tab}
          onChange={(v) => {
            setTab(v);
            changed("tab");
          }}
          options={[
            { value: "all", label: t.library.tabs.all },
            { value: "slideshow", label: t.library.tabs.slideshow },
            { value: "video", label: t.library.tabs.video },
          ]}
        />
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-fg-dim" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.library.searchPlaceholder}
            aria-label={t.library.searchPlaceholder}
            enterKeyHint="search"
            className="h-11 w-full rounded-full border border-white/[0.07] bg-white/[0.04] pr-11 pl-11 text-[15px] text-fg outline-none placeholder:text-fg-dim focus:border-lilac-300/35 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-fg-dim hover:text-fg" aria-label={t.library.clearSearch}>
              <X className="size-4" />
            </button>
          ) : null}
        </label>
        <div className="no-scrollbar fade-x -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
          <Chip
            active={sort === "new"}
            onClick={() => {
              setSort("new");
              changed("sort");
            }}
          >
            {t.library.filters.new}
          </Chip>
          <Chip
            active={sort === "old"}
            onClick={() => {
              setSort("old");
              changed("sort");
            }}
          >
            {t.library.filters.old}
          </Chip>
          <span className="mx-0.5 w-px shrink-0 self-stretch bg-white/[0.08]" aria-hidden />
          <Chip
            active={favorites}
            icon={<Heart className={cn("size-3.5", favorites && "fill-current")} aria-hidden />}
            onClick={() => {
              setFavorites(!favorites);
              changed("favorites");
            }}
          >
            {t.library.filters.favorites}
          </Chip>
          <Chip
            active={status === "ready"}
            onClick={() => {
              setStatus(status === "ready" ? null : "ready");
              changed("status");
            }}
          >
            {t.library.filters.ready}
          </Chip>
          <Chip
            active={status === "processing"}
            onClick={() => {
              setStatus(status === "processing" ? null : "processing");
              changed("status");
            }}
          >
            {t.library.filters.processing}
          </Chip>
        </div>
      </div>

      <section className="px-5 pt-1" aria-busy={lib.isFetching}>
        {lib.isError && items.length === 0 ? (
          <ErrorState title={t.library.loadError} text={errorMessage(lib.error)} onRetry={() => void lib.refetch()} retryLabel={t.common.tryAgain} />
        ) : lib.isLoading ? (
          <ul className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <DreamCardSkeleton key={i} />
            ))}
          </ul>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search className="size-7" strokeWidth={1.5} />}
              title={t.library.noResults}
              text={t.library.noResultsText}
              action={
                <Button variant="secondary" onClick={reset}>
                  {t.library.resetFilters}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t.library.emptyTitle}
              text={t.library.emptyText}
              action={
                <Button size="lg" onClick={() => router.push("/")}>
                  <Mic />
                  {t.library.emptyCta}
                </Button>
              }
            />
          )
        ) : (
          <motion.ul layout="position" className={cn("grid grid-cols-2 gap-3 transition-opacity", lib.isPlaceholderData && "opacity-60")}>
            {items.map((item, i) => (
              <DreamCard key={item.id} item={item} index={i} tab={tab} />
            ))}
            {lib.isFetchingNextPage ? (
              <>
                <DreamCardSkeleton />
                <DreamCardSkeleton />
              </>
            ) : null}
          </motion.ul>
        )}
        <div ref={sentinel} className="h-4" aria-hidden />
      </section>
    </div>
  );
}
