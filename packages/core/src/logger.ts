/* Minimal structured JSON logger with secret redaction. */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEYS = /(token|secret|password|authorization|api[_-]?key|init[_-]?data|cookie|signature|sig)$/i;
const SECRET_PATTERNS: RegExp[] = [
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, // telegram bot token
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // openai-style key
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\br8_[A-Za-z0-9]{20,}\b/g, // replicate
  /(Key|Bearer)\s+[A-Za-z0-9._:-]{16,}/g,
];

function redactString(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function currentLevel(): Level {
  const l = (process.env.LOG_LEVEL ?? "info") as Level;
  return l in ORDER ? l : "info";
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[currentLevel()]) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      level,
      msg: redactString(msg),
      ...(redact(bindings) as object),
      ...(meta ? (redact(meta) as object) : {}),
    });
    if (level === "error" || level === "warn") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };
  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    child: (b) => createLogger({ ...bindings, ...b }),
  };
}

export const logger = createLogger();
export { redact as redactForLog };
