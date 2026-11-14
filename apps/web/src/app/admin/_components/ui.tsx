import Link from "next/link";
import type { ReactNode } from "react";
import { entry, type Tone } from "../_lib/dict";

/** Server-side presentational primitives for the admin panel. */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-page-head">
      <div>
        <h1 className="adm-h1">{title}</h1>
        {subtitle ? <p className="adm-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="adm-row">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className, id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`adm-card ${className ?? ""}`} id={id}>
      {title || actions ? (
        <div className="adm-card-head">
          <div>
            {title ? <h2 className="adm-h2">{title}</h2> : null}
            {subtitle ? <p className="adm-card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="adm-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className={`adm-stat ${tone ? `adm-tone-${tone}` : ""}`}>
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value">{value}</div>
      {hint ? <div className="adm-stat-hint">{hint}</div> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`adm-badge adm-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Badge for a value from a status dictionary. */
export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string | null | undefined }) {
  const [label, tone] = entry(map, value);
  return <Badge tone={tone}>{label}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="adm-empty">{children}</div>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="adm-empty-cell">
        {children}
      </td>
    </tr>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="adm-kv">
      {items.map(([k, v]) => (
        <div key={k} className="adm-kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({ page, hasNext, href }: { page: number; hasNext: boolean; href: (page: number) => string }) {
  if (page <= 1 && !hasNext) return null;
  return (
    <nav className="adm-pager" aria-label="Страницы">
      {page > 1 ? (
        <Link className="adm-btn adm-btn-ghost adm-btn-sm" href={href(page - 1)}>
          ← Назад
        </Link>
      ) : (
        <span />
      )}
      <span className="adm-muted">Страница {page}</span>
      {hasNext ? (
        <Link className="adm-btn adm-btn-ghost adm-btn-sm" href={href(page + 1)}>
          Далее →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Filter tabs rendered as links (GET navigation). */
export function FilterTabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="adm-tabs" role="tablist">
      {items.map((i) => (
        <Link key={i.key} href={i.href} role="tab" aria-selected={i.key === active} className={`adm-tab ${i.key === active ? "is-active" : ""}`}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`adm-field ${wide ? "adm-field-wide" : ""}`}>
      <span className="adm-field-label">{label}</span>
      {children}
      {hint ? <span className="adm-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="adm-mono" title={title}>
      {children}
    </span>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="adm-table-wrap">{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`adm-notice adm-notice-${tone}`}>{children}</div>;
}
