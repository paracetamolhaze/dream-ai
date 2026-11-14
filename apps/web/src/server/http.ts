import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, isAppError } from "@dream/core/errors";
import { logger } from "@dream/core/logger";
import { ProviderError } from "@dream/core/errors";

export function json<T>(data: T, init?: number | ResponseInit): NextResponse {
  const resInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, { ...resInit, headers: { "cache-control": "no-store", ...(resInit?.headers ?? {}) } });
}

export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof ZodError) {
    return json({ error: { code: "validation_failed", message: "Invalid request", details: { issues: err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) } } }, 400);
  }
  if (err instanceof ProviderError) {
    logger.warn("provider error in request", { error: err.message });
    return json({ error: { code: err.code, message: "Service temporarily unavailable" } }, 503);
  }
  logger.error("unhandled API error", { error: err });
  return json({ error: { code: "internal", message: "Internal error" } }, 500);
}

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler with uniform error handling. */
export function handler<P = Record<string, never>>(fn: (req: NextRequest, ctx: { params: P }) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, { params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 200_000) throw new AppError("validation_failed", "Body too large");
    body = text ? JSON.parse(text) : {};
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new AppError("validation_failed", "Invalid JSON");
  }
  return schema.parse(body);
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
}
