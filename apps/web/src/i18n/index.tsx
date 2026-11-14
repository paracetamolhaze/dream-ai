"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isApiError } from "@/lib/api";
import { dictionaries, errorText, resolveLocale, type Dict, type Locale } from "./dict";

export type { Dict, Locale } from "./dict";
export { intlLocale, resolveLocale } from "./dict";

interface I18nValue {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
  /** Localized message for any thrown error (ApiError codes, network…). */
  errorMessage: (err: unknown) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Initial language from Telegram (or the browser); the profile language wins
  // once the session loads. Only the text-free splash is rendered on the server.
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "ru";
    const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    return resolveLocale(tgLang ?? navigator.language);
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);

  const value = useMemo<I18nValue>(() => {
    const t = dictionaries[locale];
    return {
      locale,
      t,
      setLocale,
      errorMessage: (err: unknown) => (isApiError(err) ? errorText(t, err.code) : errorText(t, null)),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("I18nProvider is missing");
  return ctx;
}

export function useT(): Dict {
  return useI18n().t;
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const { locale, setLocale } = useI18n();
  return [locale, setLocale];
}

export function useErrorMessage(): (err: unknown) => string {
  return useI18n().errorMessage;
}
