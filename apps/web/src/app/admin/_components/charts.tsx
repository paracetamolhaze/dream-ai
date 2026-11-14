import type { Tone } from "../_lib/dict";

/** Dependency-free inline SVG charts (server-rendered). */

export function BarChart({
  data,
  height = 150,
  tone = "accent",
  format = (n: number) => String(n),
  label,
}: {
  data: { label: string; value: number }[];
  height?: number;
  tone?: Tone;
  format?: (n: number) => string;
  label: string;
}) {
  const barW = 22;
  const gap = 8;
  const top = 18;
  const bottom = 22;
  const width = Math.max(1, data.length) * (barW + gap) + gap;
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotH = height - top - bottom;
  const total = data.reduce((s, d) => s + d.value, 0);
  const labelEvery = data.length > 16 ? 3 : data.length > 8 ? 2 : 1;
  return (
    <figure className="adm-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: всего ${format(total)}`} preserveAspectRatio="none" className={`adm-chart-svg adm-chart-${tone}`}>
        <line x1={0} x2={width} y1={top + plotH + 0.5} y2={top + plotH + 0.5} className="adm-chart-axis" />
        <line x1={0} x2={width} y1={top + 0.5} y2={top + 0.5} className="adm-chart-grid" />
        <line x1={0} x2={width} y1={top + plotH / 2 + 0.5} y2={top + plotH / 2 + 0.5} className="adm-chart-grid" />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(2, (d.value / max) * plotH) : 0;
          const x = gap + i * (barW + gap);
          const y = top + plotH - h;
          return (
            <g key={`${d.label}-${i}`}>
              <rect x={x} y={y} width={barW} height={h} rx={5} className="adm-chart-bar">
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
              {d.value > 0 && data.length <= 16 ? (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="adm-chart-value">
                  {format(d.value)}
                </text>
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="adm-chart-label">
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="adm-chart-caption">
        <span>{label}</span>
        <span className="adm-chart-total">
          Σ {format(total)} · max {format(max === 1 && total === 0 ? 0 : max)}
        </span>
      </figcaption>
    </figure>
  );
}

export function Funnel({ stages }: { stages: { key: string; label: string; users: number }[] }) {
  const first = stages[0]?.users ?? 0;
  return (
    <ol className="adm-funnel">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]!.users : s.users;
        const ofFirst = first > 0 ? s.users / first : 0;
        const ofPrev = prev > 0 ? s.users / prev : 0;
        return (
          <li key={s.key} className="adm-funnel-step">
            <div className="adm-funnel-meta">
              <span className="adm-funnel-label">{s.label}</span>
              <span className="adm-funnel-num">
                {s.users.toLocaleString("ru-RU")}
                <span className="adm-muted"> · {(ofFirst * 100).toFixed(1)}%</span>
                {i > 0 ? <span className="adm-faint"> (шаг {(ofPrev * 100).toFixed(0)}%)</span> : null}
              </span>
            </div>
            <div className="adm-funnel-track">
              <div className="adm-funnel-fill" style={{ width: `${Math.max(first > 0 ? 1.5 : 0, ofFirst * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal share bars (e.g. job statuses, sources). */
export function ShareBars({ items, format = (n: number) => n.toLocaleString("ru-RU") }: { items: { label: string; value: number; tone?: Tone }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="adm-share">
      {items.map((i) => (
        <li key={i.label} className="adm-share-row">
          <span className="adm-share-label">{i.label}</span>
          <span className="adm-share-track">
            <span className={`adm-share-fill adm-fill-${i.tone ?? "accent"}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="adm-share-num">{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}
