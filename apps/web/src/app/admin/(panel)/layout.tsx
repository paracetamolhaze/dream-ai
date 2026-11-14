import type { ReactNode } from "react";
import { count, eq } from "drizzle-orm";
import { env } from "@dream/core/env";
import { getDb } from "@dream/core/db/client";
import { supportTickets } from "@dream/core/db/schema";
import { roleAtLeast } from "@dream/core/services/admin-ops";
import { SideNav, type NavItem } from "../_components/nav";
import { ROLE } from "../_lib/dict";
import { requireAdmin } from "@/server/admin/session";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const e = env();
  const [open] = await getDb().select({ n: count() }).from(supportTickets).where(eq(supportTickets.status, "open"));
  const canManage = roleAtLeast(admin.role, "admin");

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: "Обзор",
      items: [
        { href: "/admin", label: "Дашборд", icon: "◈" },
        { href: "/admin/users", label: "Пользователи", icon: "◉" },
        { href: "/admin/generations", label: "Генерации", icon: "✦" },
        { href: "/admin/payments", label: "Платежи", icon: "⭐" },
        { href: "/admin/support", label: "Поддержка", icon: "✉", badge: open?.n ?? 0 },
      ],
    },
  ];
  if (canManage) {
    groups.push(
      {
        title: "Продукт",
        items: [
          { href: "/admin/models", label: "Модели и лимиты", icon: "⚙" },
          { href: "/admin/monetization", label: "Монетизация", icon: "₪" },
          { href: "/admin/content", label: "Стили и музыка", icon: "♫" },
        ],
      },
      {
        title: "Рост",
        items: [
          { href: "/admin/promo", label: "Промокоды", icon: "%" },
          { href: "/admin/referrals", label: "Рефералы", icon: "⇄" },
          { href: "/admin/campaigns", label: "Кампании", icon: "⌖" },
          { href: "/admin/channel", label: "Telegram-канал", icon: "➤" },
        ],
      },
    );
  }
  groups.push({
    title: "Система",
    items: [
      ...(admin.role === "owner" ? [{ href: "/admin/team", label: "Команда", icon: "♛" }] : []),
      ...(canManage ? [{ href: "/admin/audit", label: "Журнал действий", icon: "☰" }] : []),
    ],
  });

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <span className="adm-brand-mark" aria-hidden>
            ☾
          </span>
          <div>
            <div className="adm-brand-name">{e.APP_NAME}</div>
            <div className="adm-brand-sub">Админ-панель</div>
          </div>
        </div>
        <SideNav groups={groups.filter((g) => g.items.length > 0)} />
        <div className="adm-sidebar-foot">
          <div className="adm-whoami">
            <span className="adm-muted">TG id</span> <span className="adm-mono">{admin.telegramId}</span>
            <div className="adm-faint">{ROLE[admin.role]}</div>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="adm-btn adm-btn-ghost adm-btn-sm">
              Выйти
            </button>
          </form>
        </div>
      </aside>
      <main className="adm-main">
        <div className="adm-envbar">
          <span className={`adm-badge ${e.APP_ENV === "production" ? "adm-badge-good" : "adm-badge-warn"}`}>{e.APP_ENV}</span>
          {e.DEMO_MODE ? (
            <span className="adm-badge adm-badge-warn" title="Провайдеры без ключей заменяются демо-провайдерами">
              DEMO_MODE
            </span>
          ) : null}
          {!e.TELEGRAM_BOT_TOKEN ? <span className="adm-badge adm-badge-bad">нет TELEGRAM_BOT_TOKEN</span> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
