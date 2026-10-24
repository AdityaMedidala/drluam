import {
  IconButton, InlineNotification, SkeletonPlaceholder, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@carbon/react";
import { ChartLine, DataTable, Download, Maximize, Minimize } from "@carbon/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChartColors } from "../theme";

/** "1,383 MW" -> 1,383 with the unit muted. Strings without a known unit pass through. */
export function withUnit(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const m = text.match(/^(.*?)\s?(MW|GWh|MWh|GW|%)$/);
  return m ? <>{m[1]}<span className="unit">{m[2]}</span></> : text;
}

/** Compact legend, top-left above a plot: line, dashed-line or band swatches with their labels. */
export function ChartLegend({ items }: { items: { label: string; color: string; kind?: "line" | "dash" | "band" | "bar" }[] }) {
  return (
    <ul className="chart-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label}>
          {i.kind === "band" || i.kind === "bar" ? (
            // square swatch for areas and bars; bands at fill opacity, bars solid
            <svg width="12" height="12" aria-hidden><rect x="0" y="0" width="12" height="12" fill={i.color} opacity={i.kind === "band" ? 0.45 : 1} /></svg>
          ) : (
            <svg width="20" height="12" aria-hidden>
              <line x1="0" y1="6" x2="20" y2="6" stroke={i.color} strokeWidth="2" strokeDasharray={i.kind === "dash" ? "5 3" : undefined} />
            </svg>
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

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

// ------------------------------------------------------------------ chart frame (Carbon Charts-style chrome)

/** A chart's data as a table: shown by "Show as table" and exported by "Download CSV". */
export interface TableSpec {
  columns: { label: string; numeric?: boolean }[];
  rows: (string | number | null)[][];
}

const cell = (v: string | number | null, numeric?: boolean) =>
  v == null ? "–" : numeric && typeof v === "number" ? Math.round(v).toLocaleString("en-GB") : String(v);

function downloadCsv(name: string, t: TableSpec) {
  const esc = (v: string | number | null) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  // Whole MW/GWh in the export too, matching the table view.
  const value = (v: string | number | null, numeric?: boolean) => (numeric && typeof v === "number" ? Math.round(v) : v);
  const csv = [t.columns.map((c) => esc(c.label)), ...t.rows.map((r) => r.map((v, j) => esc(value(v, t.columns[j]?.numeric))))]
    .map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

/** Title, optional subtitle, toolbar (table / full screen / CSV), legend, and the plot or its table. */
export function ChartFrame({ title, subtitle, legend, table, fileName, plotClassName, ariaLabel, children }: {
  title: string; subtitle?: ReactNode; legend?: ReactNode; table: TableSpec; fileName: string;
  plotClassName: string; ariaLabel: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [asTable, setAsTable] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => (full ? document.exitFullscreen() : ref.current?.requestFullscreen());
  return (
    <div className="chart-frame" ref={ref}>
      <div className="chart-head">
        <div>
          <h2 className="chart-title">{title}</h2>
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
        <div className="chart-toolbar" role="toolbar" aria-label={`${title} tools`}>
          <IconButton kind="ghost" size="sm" align="bottom" label={asTable ? "Show as chart" : "Show as table"} onClick={() => setAsTable(!asTable)}>
            {asTable ? <ChartLine /> : <DataTable />}
          </IconButton>
          <IconButton kind="ghost" size="sm" align="bottom" label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>
            {full ? <Minimize /> : <Maximize />}
          </IconButton>
          <IconButton kind="ghost" size="sm" align="bottom-right" label="Download CSV" onClick={() => downloadCsv(fileName, table)}>
            <Download />
          </IconButton>
        </div>
      </div>
      {!asTable && legend}
      {asTable ? (
        <div className={`${plotClassName} chart-table`}>
          <Table size="sm" aria-label={`${title}: data`} className="num-table">
            <TableHead><TableRow>{table.columns.map((c) => <TableHeader key={c.label}>{c.label}</TableHeader>)}</TableRow></TableHead>
            <TableBody>
              {table.rows.map((r, i) => (
                <TableRow key={i}>{r.map((v, j) => <TableCell key={j}>{cell(v, table.columns[j]?.numeric)}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className={plotClassName} role="img" aria-label={ariaLabel}>{children}</div>
      )}
    </div>
  );
}

/** Recharts <Customized> renderer: a frame around the plot area. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const plotFrame = (c: ChartColors) => (p: any) =>
  p.offset ? <rect x={p.offset.left} y={p.offset.top} width={p.offset.width} height={p.offset.height} fill="none" stroke={c.axis} strokeOpacity={0.5} /> : null;

/** Shared axis props: visible axis lines in the Carbon axis grey, 12px ticks. */
export const xAxisProps = (c: ChartColors) => ({ stroke: c.axis, axisLine: true, tickLine: true, fontSize: 12 });
export const yAxisProps = (c: ChartColors, title = "GW") => ({
  stroke: c.axis, axisLine: true, tickLine: true, fontSize: 12, width: 52,
  label: { value: title, angle: -90, position: "insideLeft" as const, offset: 12, fill: c.axis, fontSize: 12 },
});
