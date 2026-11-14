import { ProviderError } from "../errors";

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** fetch wrapper with timeout, JSON handling and provider error mapping. */
export async function fetchJson<T = unknown>(provider: string, url: string, opts: FetchJsonOptions = {}): Promise<T> {
  // A job cancelled before this call must not start new (paid) provider requests.
  if (opts.signal?.aborted) throw new ProviderError(provider, "request aborted", { retryable: false, code: "generation_failed" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), opts.timeoutMs ?? 120_000);
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: RequestInit["body"] | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body, (_k, v) => (v === undefined ? undefined : v));
    }
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: controller.signal });
    } catch (err) {
      const timedOut = controller.signal.aborted && !opts.signal?.aborted;
      throw new ProviderError(provider, timedOut ? "request timed out" : `network error: ${(err as Error).message}`, {
        retryable: true,
        code: timedOut ? "provider_timeout" : "provider_unavailable",
        cause: err,
      });
    }
    const text = await res.text();
    if (!res.ok) throw ProviderError.fromHttp(provider, res.status, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(provider, `invalid JSON response: ${text.slice(0, 200)}`, { retryable: true });
    }
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Downloads a binary resource (provider output) into memory. */
export async function fetchBytes(provider: string, url: string, timeoutMs = 300_000): Promise<{ bytes: Buffer; contentType?: string }> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new ProviderError(provider, "invalid data URI", { retryable: false });
    return { bytes: Buffer.from(m[3]!, m[2] ? "base64" : "utf8"), contentType: m[1] };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw ProviderError.fromHttp(provider, res.status, await res.text().catch(() => ""));
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? undefined };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(provider, `download failed: ${(err as Error).message}`, { retryable: true, cause: err });
  } finally {
    clearTimeout(t);
  }
}
