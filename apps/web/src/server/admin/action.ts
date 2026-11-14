import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";
import { isAppError } from "@dream/core/errors";
import { logger } from "@dream/core/logger";
import { audit } from "@dream/core/services/admin-auth";
import type { AdminRole } from "@dream/core/services/admin-ops";
import { parseLocalDateTime } from "@/app/admin/_lib/format";
import type { ActionState } from "@/app/admin/_lib/types";
import { requestIp, requireAdmin, type AdminSession } from "./session";

/**
 * Factory for admin server actions: role check → zod validation of the
 * FormData → business call → audit log entry → cache revalidation.
 * Errors are converted into a readable state for <ActionForm>; Next.js
 * navigation errors (redirect to login) are re-thrown.
 */

export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else out[k] = v;
  }
  return out;
}

export interface ActionOutcome {
  message?: string;
  target?: { type: string; id: string };
  payload?: Record<string, unknown>;
  revalidate?: string[];
  data?: Record<string, string>;
}

const ERROR_RU: Record<string, string> = {
  unauthorized: "Сессия истекла — войдите снова",
  forbidden: "Недостаточно прав для этого действия",
  not_found: "Не найдено",
  validation_failed: "Проверьте введённые данные",
  conflict: "Действие недоступно в текущем состоянии",
  insufficient_credits: "Недостаточно кредитов на балансе",
  account_restricted: "Аккаунт пользователя ограничен",
  job_already_running: "Для этого сна уже выполняется генерация этого формата",
  dream_not_ready: "Сон ещё не готов к генерации",
  rate_limited: "Слишком много попыток — подождите",
  promo_invalid: "Промокод недействителен",
  promo_already_used: "Промокод уже использован",
  promo_exhausted: "Лимит активаций исчерпан",
  audio_unsupported: "Неподдерживаемый формат аудио",
  audio_too_large: "Файл слишком большой",
  audio_empty: "Пустой файл",
  provider_unavailable: "Внешний сервис недоступен",
  spend_limit_reached: "Достигнут лимит расходов",
};

export function describeError(err: unknown): string {
  if (err instanceof ZodError) {
    return `Проверьте поля: ${err.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "форма"} — ${i.message}`)
      .join("; ")}`;
  }
  if (isAppError(err)) {
    const label = ERROR_RU[err.code] ?? "Ошибка";
    return err.message && err.message !== err.code ? `${label} (${err.message})` : label;
  }
  if (err && typeof err === "object" && (err as { name?: string }).name === "GrammyError") {
    return `Telegram отклонил запрос: ${(err as { description?: string }).description ?? "ошибка"}`;
  }
  logger.error("admin action failed", { error: err });
  return "Внутренняя ошибка — подробности в логах сервера";
}

export function adminAction<S extends z.ZodType>(opts: {
  /** Audit action name, e.g. "user.credits.adjust". */
  name: string;
  role?: AdminRole;
  schema: S;
  revalidate?: string[];
  run: (input: z.infer<S>, admin: AdminSession) => Promise<ActionOutcome | void>;
}) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      const admin = await requireAdmin(opts.role ?? "admin");
      const input = opts.schema.parse(formToObject(formData));
      const res = (await opts.run(input, admin)) ?? {};
      await audit(admin.telegramId, opts.name, res.target, res.payload, await requestIp()).catch((err: Error) =>
        logger.error("audit write failed", { action: opts.name, error: err.message }),
      );
      for (const p of new Set([...(opts.revalidate ?? []), ...(res.revalidate ?? [])])) revalidatePath(p);
      return { ok: true, message: res.message ?? "Сохранено", at: Date.now(), data: res.data };
    } catch (err) {
      unstable_rethrow(err);
      return { ok: false, message: describeError(err), at: Date.now() };
    }
  };
}

// ─── zod helpers for FormData ───────────────────────────────────────────────

/** Checkbox: present ("on") → true, absent → false. */
export const zCheckbox = z.unknown().transform((v) => v === "on" || v === "true" || v === "1" || v === true);

export const zText = (max = 500, min = 0) => z.string().trim().min(min).max(max);

/** Optional text: empty → null. */
export const zOptText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const zInt = (min = -1_000_000_000, max = 1_000_000_000) => z.coerce.number().int().min(min).max(max);

export const zNum = (min = -1e9, max = 1e9) => z.coerce.number().min(min).max(max);

/** Optional integer: empty → null. */
export const zOptInt = (min = 0, max = 1_000_000_000) =>
  z
    .union([z.string(), z.undefined()])
    .transform((v) => (v === undefined || v.trim() === "" ? null : Number(v)))
    .pipe(z.number().int().min(min).max(max).nullable());

export const zUuid = z.string().uuid();

/** <input type="datetime-local"> in the admin timezone → Date (or null when empty). */
export const zOptDateTime = z
  .union([z.string(), z.undefined()])
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const d = parseLocalDateTime(v.trim());
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Неверная дата" });
      return z.NEVER;
    }
    return d;
  });
