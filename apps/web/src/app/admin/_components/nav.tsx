"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: number;
}

export function SideNav({ groups }: { groups: { title: string; items: NavItem[] }[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav className="adm-nav" aria-label="Разделы админ-панели">
      {groups.map((g) => (
        <div key={g.title} className="adm-nav-group">
          <div className="adm-nav-title">{g.title}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={`adm-nav-link ${isActive(i.href) ? "is-active" : ""}`} aria-current={isActive(i.href) ? "page" : undefined}>
              <span className="adm-nav-icon" aria-hidden>
                {i.icon}
              </span>
              <span className="adm-nav-text">{i.label}</span>
              {i.badge ? <span className="adm-nav-badge">{i.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
