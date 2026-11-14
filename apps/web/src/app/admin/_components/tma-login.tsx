"use client";

import { useEffect, useState } from "react";

type TelegramLike = { WebApp?: { initData?: string; ready?: () => void } };

function telegram(): TelegramLike | undefined {
  return (window as unknown as { Telegram?: TelegramLike }).Telegram;
}

/** Loads the official Mini App script if the page was opened inside Telegram but the script is absent. */
async function ensureTelegram(): Promise<TelegramLike | undefined> {
  if (telegram()?.WebApp) return telegram();
  // Telegram passes launch params in the URL hash; the official script keeps them in
  // sessionStorage after in-app navigations. Without either we are not inside a Mini App.
  let stored = false;
  try {
    stored = Boolean(window.sessionStorage.getItem("__telegram__initParams"));
  } catch {
    stored = false;
  }
  if (!/tgWebAppData=/.test(window.location.hash) && !stored) return undefined;
  await new Promise<void>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
    setTimeout(resolve, 4000);
  });
  return telegram();
}

/**
 * Sign-in from inside the Telegram Mini App: the verified initData proves the
 * Telegram identity; the server sets the admin cookie if the id is an admin.
 */
export function TmaLogin() {
  const [state, setState] = useState<"idle" | "checking" | "denied" | "error" | "outside">("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tg = await ensureTelegram();
      const initData = tg?.WebApp?.initData;
      if (cancelled) return;
      if (!initData) {
        setState("outside");
        return;
      }
      tg?.WebApp?.ready?.();
      setState("checking");
      try {
        const res = await fetch("/admin/login/tma", { headers: { authorization: `tma ${initData}` }, cache: "no-store", credentials: "same-origin" });
        if (cancelled) return;
        if (res.ok) {
          window.location.replace("/admin");
          return;
        }
        setState(res.status === 403 ? "denied" : "error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "idle" || state === "outside") return null;
  return (
    <div className={`adm-notice ${state === "checking" ? "adm-notice-info" : "adm-notice-bad"}`}>
      {state === "checking" && "Проверяем вашу учётную запись Telegram…"}
      {state === "denied" && "Этот Telegram-аккаунт не является администратором."}
      {state === "error" && "Не удалось войти через Telegram. Используйте ссылку из бота."}
    </div>
  );
}
