import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@dream/core/env";
import { ActionForm, Submit } from "../../_components/action-form";
import { TmaLogin } from "../../_components/tma-login";
import { sp } from "../../_lib/format";
import { readAdminSession } from "@/server/admin/session";
import { loginWithToken } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const session = await readAdminSession();
  if (session) redirect("/admin");
  const token = sp(params, "token");
  const e = env();
  const bot = e.TELEGRAM_BOT_USERNAME;
  return (
    <div className="adm-login">
      <div className="adm-login-card">
        <div className="adm-login-logo" aria-hidden>
          ☾
        </div>
        <h1 className="adm-h1">{e.APP_NAME} · Админ-панель</h1>
        {token ? (
          <>
            <p className="adm-muted">Подтвердите вход по одноразовой ссылке из Telegram-бота.</p>
            <ActionForm action={loginWithToken}>
              <input type="hidden" name="token" value={token} />
              <Submit>Войти в админ-панель</Submit>
            </ActionForm>
          </>
        ) : (
          <>
            <p className="adm-muted">Доступ только для администраторов из списка разрешённых Telegram-аккаунтов.</p>
            <ol className="adm-steps">
              <li>
                Откройте бота{" "}
                {bot ? (
                  <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">
                    @{bot}
                  </a>
                ) : (
                  "проекта"
                )}{" "}
                и отправьте команду <code>/admin</code>.
              </li>
              <li>Нажмите на одноразовую ссылку — она действует 10 минут.</li>
              <li>Или откройте «Профиль → Админ-панель» внутри Mini App — вход выполнится автоматически.</li>
            </ol>
            <TmaLogin />
          </>
        )}
      </div>
    </div>
  );
}
