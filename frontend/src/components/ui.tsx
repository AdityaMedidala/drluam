import type { ReactNode } from "react";

/** "1,383 MW" -> 1,383 with the unit in a smaller, muted span. Strings without a known unit pass through. */
export function withUnit(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const m = text.match(/^(.*?)\s?(MW|GWh|MWh|GW|%)$/);
  return m ? <>{m[1]}<span className="unit">{m[2]}</span></> : text;
}

export function StatTile({ label, value, sub, note, tone }: { label: string; value: ReactNode; sub?: ReactNode; note?: string; tone?: "accent" }) {
  return (
    <div className={`tile ${tone === "accent" ? "tile-accent" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{withUnit(value)}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      {note && <div className="tile-sub tile-note" role="note">{note}</div>}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, children, wide }: {
  title: string; subtitle?: ReactNode; legend?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  return (
    <section className={`card ${wide ? "card-wide" : ""}`}>
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {legend && <div className="legend">{legend}</div>}
      </header>
      {children}
    </section>
  );
}

export function LegendItem({ color, label, dashed, band }: { color: string; label: string; dashed?: boolean; band?: boolean }) {
  return (
    <span className="legend-item">
      {band ? (
        <span className="swatch-band" style={{ background: color }} />
      ) : (
        <svg width="18" height="8" aria-hidden>
          <line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? "4 3" : undefined} />
        </svg>
      )}
      {label}
    </span>
  );
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

/** Numbered section label for the Decision view's modules ("01 Plan"). */
export function ModuleLabel({ n, children }: { n: string; children: ReactNode }) {
  return <h2 className="module-label"><span className="num">{n}</span> {children}</h2>;
}

export function Insight({ children }: { children: ReactNode }) {
  return <div className="insight">{children}</div>;
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
      <strong>Couldn't load this data.</strong> Check the API is running, then reload. <span className="muted">({error})</span>
    </div>
  );
}
