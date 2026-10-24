import { InlineNotification, SkeletonPlaceholder } from "@carbon/react";
import type { ReactNode } from "react";

/** "1,383 MW" -> 1,383 with the unit muted. Strings without a known unit pass through. */
export function withUnit(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const m = text.match(/^(.*?)\s?(MW|GWh|MWh|GW|%)$/);
  return m ? <>{m[1]}<span className="unit">{m[2]}</span></> : text;
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

/** The one tooltip used by every chart (Carbon data-viz style): a title and label/value rows with swatches. */
export function ChartTooltip({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="chart-tooltip">
      <div className="t-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="t-row">
          <span>{r.color && <span className="swatch" style={{ background: r.color }} aria-hidden />}{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Loading({ height = 120 }: { height?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <SkeletonPlaceholder style={{ width: "100%", height }} />
    </div>
  );
}

export function ErrorState({ error }: { error: string }) {
  return (
    <InlineNotification kind="error" lowContrast hideCloseButton role="alert"
      title="Couldn't load this data." subtitle={`Check the API is running, then reload. (${error})`} />
  );
}
