import { en } from "./en";
import { ru } from "./ru";

export type Dict = typeof ru;
export type Locale = "ru" | "en";

export const dictionaries: Record<Locale, Dict> = { ru, en };

/** Same mapping as the server: CIS languages → ru, everything else → en. */
export function resolveLocale(code?: string | null): Locale {
  if (!code) return "ru";
  const lc = code.toLowerCase();
  if (lc.startsWith("en")) return "en";
  if (["ru", "uk", "be", "kk", "uz", "ky", "tg", "hy", "az", "ka"].some((p) => lc.startsWith(p))) return "ru";
  return "en";
}

export function intlLocale(locale: Locale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

/** Localized text for an API error code. */
export function errorText(t: Dict, code: string | null | undefined): string {
  if (!code) return t.errors.default!;
  return t.errors[code] ?? t.errors.default!;
}
