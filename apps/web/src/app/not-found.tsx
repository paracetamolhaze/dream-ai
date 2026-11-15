"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { NightSky } from "@/components/app/background";
import { LogoMark } from "@/components/app/logo";
import { dictionaries, resolveLocale } from "@/i18n/dict";

// Static-friendly: no request headers — the language comes from the browser after hydration.
const noSubscribe = () => () => {};
const useBrowserLanguage = () =>
  useSyncExternalStore(
    noSubscribe,
    () => navigator.language,
    () => "ru",
  );

export default function NotFound() {
  const t = dictionaries[resolveLocale(useBrowserLanguage())];
  return (
    <>
      <NightSky />
      <div className="relative z-10 flex min-h-app flex-col items-center justify-center px-8 text-center">
        <div className="relative mb-8 grid size-28 place-items-center">
          <div className="decor-anim absolute inset-0 animate-halo rounded-full bg-[radial-gradient(closest-side,rgb(150_128_255/0.35),transparent)]" />
          <LogoMark className="relative size-16" />
        </div>
        <h1 className="font-display text-[34px] leading-tight font-medium text-moon">{t.app.notFoundTitle}</h1>
        <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-fg-muted">{t.app.notFoundText}</p>
        <Link href="/" className="btn-moonlight mt-8 inline-flex h-12 items-center rounded-full px-7 text-[15px] font-semibold">
          {t.app.toHome}
        </Link>
      </div>
    </>
  );
}
