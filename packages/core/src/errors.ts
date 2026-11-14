/**
 * Application error codes. They are stable identifiers that the UI maps to
 * human-readable localized messages; internal details never leak to clients.
 */
export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "rate_limited",
  "insufficient_credits",
  "account_restricted",
  "job_already_running",
  "dream_not_ready",
  "audio_too_long",
  "audio_too_large",
  "audio_unsupported",
  "audio_empty",
  "text_too_short",
  "text_too_long",
  "transcription_failed",
  "analysis_failed",
  "generation_failed",
  "provider_unavailable",
  "provider_rejected_content",
  "provider_timeout",
  "spend_limit_reached",
  "free_limit_reached",
  "payment_invalid",
  "promo_invalid",
  "promo_already_used",
  "promo_exhausted",
  "media_unavailable",
  "conflict",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  account_restricted: 403,
  not_found: 404,
  media_unavailable: 404,
  validation_failed: 400,
  text_too_short: 400,
  text_too_long: 400,
  audio_too_long: 400,
  audio_too_large: 413,
  audio_unsupported: 415,
  audio_empty: 400,
  promo_invalid: 400,
  promo_already_used: 409,
  promo_exhausted: 409,
  rate_limited: 429,
  insufficient_credits: 402,
  free_limit_reached: 402,
  spend_limit_reached: 503,
  job_already_running: 409,
  conflict: 409,
  dream_not_ready: 409,
  payment_invalid: 400,
  provider_unavailable: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** If false, the job runner must not retry. */
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, opts: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {}) {
    super(message ?? code, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS[code] ?? 500;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Error raised by AI providers. `retryable` distinguishes transient failures. */
export class ProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly code: ErrorCode;
  readonly httpStatus?: number;

  constructor(provider: string, message: string, opts: { retryable?: boolean; code?: ErrorCode; httpStatus?: number; cause?: unknown } = {}) {
    super(`[${provider}] ${message}`, { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = opts.retryable ?? true;
    this.code = opts.code ?? "provider_unavailable";
    this.httpStatus = opts.httpStatus;
  }

  static fromHttp(provider: string, status: number, body: string): ProviderError {
    const retryable = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
    const code: ErrorCode = status === 400 || status === 422 ? (/(safety|nsfw|content|policy|moderation)/i.test(body) ? "provider_rejected_content" : "generation_failed") : "provider_unavailable";
    return new ProviderError(provider, `HTTP ${status}: ${body.slice(0, 500)}`, { retryable, code, httpStatus: status });
  }
}
