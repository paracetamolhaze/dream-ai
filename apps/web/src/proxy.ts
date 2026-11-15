import { NextResponse, type NextRequest } from "next/server";

/**
 * CORS for a separately hosted Mini App (static build on a CDN such as Vercel):
 * only the configured Mini App origin(s) may call the API from a browser.
 * Auth is still the Telegram initData header — CORS only lets the browser send it.
 */
function allowedOrigins(): Set<string> {
  const out = new Set<string>();
  const add = (u?: string) => {
    if (!u) return;
    try {
      out.add(new URL(u).origin);
    } catch {
      /* ignore malformed entries */
    }
  };
  add(process.env.PUBLIC_APP_URL);
  for (const o of (process.env.CORS_ORIGINS ?? "").split(",")) add(o.trim());
  return out;
}

function applyCors(headers: Headers, origin: string) {
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-expose-headers", "content-length, content-range, accept-ranges");
  headers.set("access-control-max-age", "86400");
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = origin && allowedOrigins().has(origin) ? origin : null;
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (allowed) applyCors(res.headers, allowed);
    return res;
  }
  const res = NextResponse.next();
  if (allowed) applyCors(res.headers, allowed);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
