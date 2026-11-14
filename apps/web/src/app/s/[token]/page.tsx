import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveShareToken } from "@dream/core/services/share";
import { miniAppLink } from "@dream/core/telegram/bot-api";
import { NightSky } from "@/components/app/background";
import { Logo } from "@/components/app/logo";
import { dictionaries, resolveLocale } from "@/i18n/dict";

export const dynamic = "force-dynamic";

// Deduplicates the lookup between generateMetadata and the page within one request.
const getShare = cache((token: string) => resolveShareToken(token));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await getShare(token);
  return {
    title: data?.title ?? "DREAM AI",
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getShare(token);
  if (!data) notFound();
  const lang = (await headers()).get("accept-language")?.split(",")[0];
  const t = dictionaries[resolveLocale(lang)];
  const media = data.media;
  const playable = media.type === "video" || media.type === "slideshow";
  let cta: string | null = null;
  try {
    cta = process.env.TELEGRAM_BOT_USERNAME ? miniAppLink("c_share") : null;
  } catch {
    cta = null;
  }

  return (
    <>
      <NightSky />
      <main className="safe-top relative z-10 mx-auto flex min-h-app w-full max-w-[520px] flex-col px-5 pb-[calc(var(--app-bottom)+32px)]">
        <header className="flex justify-center pt-2">
          <Logo />
        </header>

        {data.title ? <h1 className="mt-7 text-center font-display text-[38px] leading-[1.05] font-medium text-moon">{data.title}</h1> : <div className="mt-6" />}

        <div className="mx-auto mt-6 aspect-[9/16] w-full max-w-[min(420px,62vh)] overflow-hidden rounded-[28px] border border-white/[0.08] bg-black shadow-[0_40px_90px_-40px_rgb(150_128_255/0.55)]">
          {playable && media.url ? (
            <video src={media.url} poster={media.thumbUrl ?? undefined} controls playsInline preload="metadata" controlsList="nodownload" className="h-full w-full bg-black object-contain" />
          ) : media.url ? (
            <img src={media.url} alt={data.title ?? ""} className="h-full w-full object-cover" />
          ) : null}
        </div>

        {media.isDemo ? <p className="mt-3 text-center text-[11px] font-semibold tracking-[0.12em] text-amber-300 uppercase">{t.common.demo}</p> : null}

        {data.text ? <p className="mt-6 text-[15px] leading-[1.7] whitespace-pre-line text-fg/85">{data.text}</p> : null}

        <div className="mt-auto pt-10 text-center">
          <p className="mx-auto max-w-[300px] text-[14px] leading-relaxed text-fg-muted">{t.sharePage.tagline}</p>
          {cta ? (
            <a href={cta} className="btn-moonlight mt-5 inline-flex h-14 items-center justify-center rounded-full px-8 text-[15px] font-semibold">
              {t.sharePage.cta}
            </a>
          ) : null}
          <p className="mt-6 text-[11.5px] tracking-[0.14em] text-fg-dim uppercase">{t.sharePage.madeWith}</p>
        </div>
      </main>
    </>
  );
}
