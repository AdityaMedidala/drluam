import type { ReactNode } from "react";

/** "1,383 MW" -> 1,383 with the unit muted. Strings without a known unit pass through. */
export function withUnit(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const m = text.match(/^(.*?)\s?(MW|GWh|MWh|GW|%)$/);
  return m ? <>{m[1]}<span className="unit">{m[2]}</span></> : text;
}

/** A chart on the page (no card): finding as the title, optional short subtitle, the plot, a source line. */
export function ChartBlock({ title, subtitle, source, children, className = "" }: {
  title: ReactNode; subtitle?: ReactNode; source: string; children: ReactNode; className?: string;
}) {
  return (
    <figure className={`chart ${className}`}>
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      <div className="chart-plot">{children}</div>
      <figcaption className="source">{source}</figcaption>
    </figure>
  );
}

export const sourceLine = (cutoff: string) => `Elexon WINDFOR/FUELHH · decisions Jan 2026 · ${cutoff} cutoff`;

/** Index of the last row where `key` has a value: where a direct label goes. */
export function lastIndex(rows: Record<string, unknown>[], key: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return i;
  return -1;
}

/** Recharts `label` renderer: writes the series name once, just right of its last point (replaces a legend). */
export function endLabel(text: string, color: string, at: number, dy = 4) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (p: any) => (p.index === at && p.value != null
    ? <text key="end" x={p.x + 6} y={p.y} dy={dy} fill={color} fontSize={12} fontWeight={500}>{text}</text>
    : <g key={p.index} />);
}

/** The one tooltip used by every chart: a title and label/value rows, optionally with a colour swatch. */
export function ChartTooltip({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="tooltip-row">
          <span>{r.color && <span className="swatch" style={{ background: r.color }} aria-hidden />}{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Placeholder blocks shaped like the content, so the layout doesn't jump when data arrives. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-bar" />)}
    </div>
  );
}

export function ErrorState({ error }: { error: string }) {
  return (
    <div className="state state-error" role="alert">
      Couldn't load this data. Check the API is running, then reload. <span className="muted">({error})</span>
    </div>
  );
}
