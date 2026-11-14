import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "yes");

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_NAME: z.string().default("DREAM AI"),
  /** Public HTTPS origin of the Mini App, e.g. https://dream.example.com */
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  /** Server-side origin used by the bot/worker to build links (defaults to PUBLIC_APP_URL). */
  INTERNAL_APP_URL: optionalString,

  DATABASE_URL: z.string().default("postgres://dream:dream@localhost:5432/dream"),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("dream-media"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** "proxy" streams files through the app (works with private MinIO), "redirect" redirects to presigned S3 URLs. */
  MEDIA_DELIVERY: z.enum(["proxy", "redirect"]).default("proxy"),

  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  /** Short name of a named Mini App (t.me/<bot>/<app>). Empty = Main Mini App (t.me/<bot>?startapp=). */
  TELEGRAM_MINIAPP_SHORT_NAME: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_WEBHOOK_PATH: z.string().default("/telegram/webhook"),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
  BOT_PORT: z.coerce.number().int().default(8081),
  TELEGRAM_CHANNEL_ID: optionalString,
  TELEGRAM_CHANNEL_URL: optionalString,
  SUPPORT_CHAT_ID: optionalString,
  /** Max age of Mini App initData in seconds. */
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().min(60).default(86400),

  ADMIN_TELEGRAM_IDS: csv,
  ADMIN_SESSION_SECRET: optionalString,
  /** HMAC secret for signed media URLs and share tokens. */
  MEDIA_SIGNING_SECRET: optionalString,

  /** Development only: allow opening the Mini App in a regular browser with a signed dev identity. */
  ALLOW_DEV_AUTH: bool.default(false),

  /** Global demo mode: providers without keys fall back to clearly labelled demo providers. */
  DEMO_MODE: bool.default(false),

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  STT_API_KEY: optionalString,
  STT_BASE_URL: optionalString,
  LLM_OPENAI_API_KEY: optionalString,
  LLM_OPENAI_BASE_URL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  FAL_KEY: optionalString,
  REPLICATE_API_TOKEN: optionalString,
  RUNWAY_API_KEY: optionalString,
  IMAGE_OPENAI_API_KEY: optionalString,
  IMAGE_OPENAI_BASE_URL: optionalString,

  MAX_AUDIO_SECONDS: z.coerce.number().int().min(10).default(600),
  MAX_AUDIO_BYTES: z.coerce.number().int().min(1024).default(25 * 1024 * 1024),
  MAX_DREAM_TEXT_CHARS: z.coerce.number().int().min(200).default(8000),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  WORK_DIR: optionalString,
  /** Font file for FFmpeg drawtext (watermark, demo labels). */
  FONT_PATH: optionalString,

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
    validateProductionEnv(cached);
  }
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

function validateProductionEnv(e: Env): void {
  if (e.APP_ENV !== "production") return;
  const missing: string[] = [];
  if (!e.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!e.TELEGRAM_BOT_USERNAME) missing.push("TELEGRAM_BOT_USERNAME");
  if (!e.MEDIA_SIGNING_SECRET) missing.push("MEDIA_SIGNING_SECRET");
  if (!e.ADMIN_SESSION_SECRET) missing.push("ADMIN_SESSION_SECRET");
  if (e.BOT_MODE === "webhook" && !e.TELEGRAM_WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (e.ALLOW_DEV_AUTH) {
    throw new Error("ALLOW_DEV_AUTH must not be enabled when APP_ENV=production");
  }
}

export function isProduction(): boolean {
  return env().APP_ENV === "production";
}

export function devAuthEnabled(): boolean {
  const e = env();
  return e.ALLOW_DEV_AUTH && e.APP_ENV !== "production";
}

export function mediaSigningSecret(): string {
  const e = env();
  return e.MEDIA_SIGNING_SECRET ?? `dev-insecure-media-secret:${e.TELEGRAM_BOT_TOKEN ?? "none"}`;
}

export function adminSessionSecret(): string {
  const e = env();
  return e.ADMIN_SESSION_SECRET ?? `dev-insecure-admin-secret:${e.TELEGRAM_BOT_TOKEN ?? "none"}`;
}

export function internalAppUrl(): string {
  const e = env();
  return (e.INTERNAL_APP_URL ?? e.PUBLIC_APP_URL).replace(/\/$/, "");
}

export function publicAppUrl(): string {
  return env().PUBLIC_APP_URL.replace(/\/$/, "");
}
