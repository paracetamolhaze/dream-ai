/**
 * Mini App routes — one source of truth for the frontend, the bot and the worker.
 * Dream ids are query parameters (not path segments) so the Mini App can be
 * exported as plain static files and hosted on any CDN without server rendering.
 * Pure functions, no imports: safe in client components and server code alike.
 */

type Format = "slideshow" | "video";

const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v === true ? "1" : String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const routes = {
  home: "/",
  write: "/write",
  library: "/dreams",
  profile: "/profile",
  balance: "/profile/balance",
  invite: "/profile/invite",
  dream: (id: string, view?: Format | null) => `/dream${q({ id, view })}`,
  review: (id: string, opts: { edit?: boolean } = {}) => `/dream/review${q({ id, edit: opts.edit })}`,
  prepare: (id: string, opts: { format?: Format | null; regen?: boolean } = {}) => `/dream/prepare${q({ id, format: opts.format, regen: opts.regen })}`,
  job: (id: string, jobId: string) => `/dream/job${q({ id, job: jobId })}`,
};
