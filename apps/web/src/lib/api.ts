"use client";

import type { ApiError as ApiErrorBody } from "@dream/core/dto";
import { getInitData } from "./auth";
import { isInTelegram } from "./telegram";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  keepalive?: boolean;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toError(status: number, data: unknown): ApiError {
  const body = data as Partial<ApiErrorBody> | undefined;
  const err = body?.error;
  const fallback = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 413 ? "audio_too_large" : status === 429 ? "rate_limited" : "internal";
  return new ApiError(err?.code ?? fallback, status, err?.message, err?.details);
}

async function send(path: string, initData: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { authorization: `tma ${initData}` };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(path, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: opts.signal,
    keepalive: opts.keepalive,
    cache: "no-store",
  });
}

/** JSON API call with Telegram auth and uniform error mapping. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let initData = await getInitData();
  let res: Response;
  try {
    res = await send(path, initData, opts);
    // Dev identity expired → fetch a fresh one once (inside Telegram initData is fixed per launch).
    if (res.status === 401 && !isInTelegram()) {
      initData = await getInitData(true);
      res = await send(path, initData, opts);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network", 0, (err as Error).message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? parse(text) : undefined;
  if (!res.ok) throw toError(res.status, data);
  return data as T;
}

/** Multipart upload with real progress (XHR) — used for voice recordings and music. */
export async function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  const initData = await getInitData();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("authorization", `tma ${initData}`);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => reject(new ApiError("network", 0));
    xhr.ontimeout = () => reject(new ApiError("network", 0, "timeout"));
    xhr.timeout = 5 * 60_000;
    xhr.onload = () => {
      const data = xhr.responseText ? parse(xhr.responseText) : undefined;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(toError(xhr.status, data));
    };
    xhr.send(form);
  });
}
