"use client";

import { getWebApp } from "./telegram";

/**
 * Source of the `Authorization: tma <initData>` credential.
 * Inside Telegram it is the signed initData of the current launch. In a
 * regular browser during development the server can issue a signed dev
 * identity (`/api/auth/dev`, disabled in production); otherwise the app
 * shows "open in Telegram".
 */

export class NotInTelegramError extends Error {
  constructor() {
    super("not_in_telegram");
    this.name = "NotInTelegramError";
  }
}

let devInitData: string | null = null;
let devPromise: Promise<string> | null = null;

/** Dev identities live in a reserved id range that real Telegram accounts never use (server enforces it). */
const DEV_ID_MIN = 900_000_000_000;

function devUserId(): string {
  try {
    const key = "dream.devUserId.v2";
    let id = window.localStorage.getItem(key);
    if (!id || Number(id) < DEV_ID_MIN) {
      id = String(DEV_ID_MIN + 1 + Math.floor(Math.random() * 99_000_000_000));
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return String(DEV_ID_MIN + 1);
  }
}

async function fetchDevInitData(): Promise<string> {
  const params = new URLSearchParams({ id: devUserId(), name: "Dreamer" });
  let res: Response;
  try {
    res = await fetch(`/api/auth/dev?${params.toString()}`, { cache: "no-store" });
  } catch {
    throw new NotInTelegramError();
  }
  if (!res.ok) throw new NotInTelegramError();
  const data = (await res.json().catch(() => null)) as { initData?: string } | null;
  if (!data?.initData) throw new NotInTelegramError();
  devInitData = data.initData;
  return data.initData;
}

export async function getInitData(forceRefresh = false): Promise<string> {
  const wa = getWebApp();
  if (wa?.initData) return wa.initData;
  if (devInitData && !forceRefresh) return devInitData;
  if (!devPromise || forceRefresh) {
    devPromise = fetchDevInitData().catch((err) => {
      devPromise = null;
      throw err;
    });
  }
  return devPromise;
}

export function isDevIdentity(): boolean {
  return !getWebApp()?.initData && Boolean(devInitData);
}
