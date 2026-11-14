/** Formatting helpers for admin pages (server-side). */

/** Current time for server components (rendered once per request, force-dynamic). */
export function requestNow(): number {
  return Date.now();
}

let tzCache: string | undefined;

/** Admin display timezone (ADMIN_TIMEZONE, default Europe/Moscow); falls back to UTC if invalid. */
export function adminTz(): string {
  if (tzCache) return tzCache;
  const wanted = process.env.ADMIN_TIMEZONE || "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: wanted });
    tzCache = wanted;
  } catch {
    tzCache = "UTC";
  }
  return tzCache;
}

const dtf = () => new Intl.DateTimeFormat("ru-RU", { timeZone: adminTz(), day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const df = () => new Intl.DateTimeFormat("ru-RU", { timeZone: adminTz(), day: "2-digit", month: "short" });

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : dtf().format(date);
}

export function fmtDay(d: string): string {
  const date = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? d : df().format(date);
}

/** Value for <input type="datetime-local"> in the admin timezone. */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: adminTz(), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n !== 0 && Math.abs(n) < 0.1 ? 4 : digits) })}`;
}

export function fmtStars(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${fmtNum(n)} ⭐`;
}

export function fmtPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export function fmtSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function userLabel(u: { username?: string | null; firstName?: string | null; telegramId?: number | null } | null | undefined): string {
  if (!u) return "—";
  if (u.username) return `@${u.username}`;
  if (u.firstName) return u.firstName;
  return u.telegramId ? `id ${u.telegramId}` : "—";
}

/** Reads a single string search param. */
export function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function pageParam(params: Record<string, string | string[] | undefined>): number {
  const n = Number(sp(params, "page") ?? 1);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

/** Builds a query string preserving existing params. */
export function withParams(base: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Parses "YYYY-MM-DDTHH:mm" as wall-clock time in the admin timezone. */
export function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the admin timezone at that moment.
  const tz = adminTz();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = shown - asUtc;
  const date = new Date(asUtc - offset);
  return Number.isNaN(date.getTime()) ? null : date;
}
