"use client";

import type { ApiError as ApiErrorBody } from "@dream/core/dto";
import { getInitData } from "./auth";
import { isInTelegram } from "./telegram";

/**
 * Backend origin. Empty when the Mini App is served by the backend itself;
 * set (NEXT_PUBLIC_API_URL) for the static build hosted separately (Vercel) —
 * the browser then talks to the API directly, nothing is proxied through the host.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
}

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
  /** Abort and report `network` if the server has not answered by then (default 20 s). */
  timeoutMs?: number;
}

/**
 * Every JSON call has a deadline: a backend that silently drops packets
 * (offline server, firewall, broken NAT) must surface as a "no connection"
 * screen with a retry button — never as an endless loader.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

function deadline(outer: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    ctrl.abort();
  }, ms);
  const forward = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", forward, { once: true });
  return {
    signal: ctrl.signal,
    expired: () => expired,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", forward);
    },
  };
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

async function send(path: string, initData: string, opts: RequestOptions, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { authorization: `tma ${initData}` };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(apiUrl(path), {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal,
    keepalive: opts.keepalive,
    cache: "no-store",
  });
}

/** JSON API call with Telegram auth, a response deadline and uniform error mapping. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let initData = await getInitData();
  const dl = deadline(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await send(path, initData, opts, dl.signal);
    // Dev identity expired → fetch a fresh one once (inside Telegram initData is fixed per launch).
    if (res.status === 401 && !isInTelegram()) {
      initData = await getInitData(true);
      res = await send(path, initData, opts, dl.signal);
    }
    text = res.status === 204 ? "" : await res.text();
  } catch (err) {
    if (dl.expired()) throw new ApiError("network", 0, "timeout");
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network", 0, (err as Error).message);
  } finally {
    dl.clear();
  }
  if (res.status === 204) return undefined as T;
  const data = text ? parse(text) : undefined;
  if (!res.ok) throw toError(res.status, data);
  return data as T;
}

/** Multipart upload with real progress (XHR) — used for voice recordings and music. */
export async function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  const initData = await getInitData();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path));
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
