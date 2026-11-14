import type { Locale } from "@/i18n/dict";
import { intlLocale } from "@/i18n/dict";

/** "12 ноября 2026" / "November 12, 2026" */
export function formatDate(iso: string | Date, locale: Locale, opts: { withYear?: boolean } = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const withYear = opts.withYear ?? true;
  const s = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }).format(d);
  return locale === "ru" ? s.replace(/\s?г\.$/, "") : s;
}

export function formatDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Short date for cards: "12 ноя" within the current year, otherwise with year. */
export function formatShortDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return formatDate(d, locale, { withYear: !sameYear });
}

/** 42 → "00:42", 125 → "02:05" */
export function formatDuration(totalSec: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSec ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

export type DayPart = "night" | "morning" | "day" | "evening";

export function dayPart(date = new Date()): DayPart {
  const h = date.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "day";
  if (h < 23) return "evening";
  return "night";
}

/** Safe file name for downloads. */
export function fileNameFor(title: string | null | undefined, ext: string, fallback: string): string {
  const base = (title ?? fallback).replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60) || fallback;
  return `${base}.${ext}`;
}
