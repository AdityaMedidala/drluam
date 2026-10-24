import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DriftResponse } from "../api";
import { fmtDateTime, fmtGWh, fmtMW, fmtTime, gwAxis } from "../format";
import type { ChartColors } from "../theme";
import { ChartBlock, ChartTooltip, ErrorState, Loading, endLabel, lastIndex, sourceLine } from "./ui";

/** How the forecast for one delivery day moved across the runs published up to the cutoff. */
export default function DriftPanel({ drift, error, c }: { drift: DriftResponse | null; error: string | null; c: ChartColors }) {
  const runs = drift?.runs ?? [];
  const rows = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    runs.forEach((r, i) => r.hours.forEach((h) => {
      const row = byTime.get(h.time) ?? { time: h.time };
      row[`r${i}`] = h.forecastMW;
      byTime.set(h.time, row);
    }));
    return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [runs]);
  const ticks = useMemo(
    () => rows.map((r) => String(r.time)).filter((t) => ["00:00", "06:00", "12:00", "18:00"].includes(fmtTime(t))),
    [rows],
  );

  if (error) return <ErrorState error={error} />;
  if (!drift) return <Loading rows={1} />;
  if (runs.length === 0) return <p className="muted">No forecast runs before the cutoff for this day.</p>;

  const last = runs.length - 1;
  const change = runs[last].commonMWh - runs[0].commonMWh;
  const title = Math.abs(change) < 1000
    ? `The forecast held steady across ${runs.length} runs`
    : `The forecast ${change < 0 ? "fell" : "rose"} ${fmtGWh(Math.abs(change))} across ${runs.length} runs`;

  return (
    <ChartBlock className="narrow" title={title}
      subtitle="Grey lines are earlier runs; orange is the run the decision used."
      source={sourceLine(drift.cutoff)}>
      <div className="h-sm">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 96, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="time" tickFormatter={fmtTime} ticks={ticks} stroke={c.axis} tickLine={false} fontSize={12} />
            <YAxis {...gwAxis(runs.flatMap((r) => r.hours.map((h) => h.forecastMW)))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
            <Tooltip content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTooltip title={`${fmtTime(String(payload[0].payload.time))} UK`} rows={[
                  { label: "First run", value: fmtMW(payload[0].payload.r0 as number | undefined), color: c.axis },
                  { label: "Decision run", value: fmtMW(payload[0].payload[`r${last}`] as number | undefined), color: c.forecast },
                ]} />
              ) : null} />
            {runs.map((r, i) => (
              <Line key={r.publishedUtc} dataKey={`r${i}`} dot={false} isAnimationActive={false} connectNulls
                stroke={r.isDecisionRun ? c.forecast : c.axis}
                strokeWidth={r.isDecisionRun ? 2 : 1}
                strokeOpacity={r.isDecisionRun ? 1 : 0.2 + 0.45 * (i / Math.max(1, last))}
                label={i === 0 ? endLabel("First run", c.axis, lastIndex(rows, "r0"), -6)
                  : r.isDecisionRun ? endLabel("Decision run", c.forecast, lastIndex(rows, `r${i}`)) : undefined} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table-toggle">
        <summary>View as table</summary>
        <table>
          <thead><tr><th>Run published (UK)</th><th>Hours of the day</th><th>Total, common {drift.commonHours} h</th><th>Day total</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.publishedUtc}>
                <td>{fmtDateTime(r.publishedUtc)}{r.isDecisionRun ? " (decision)" : ""}</td>
                <td>{r.hours.length}</td><td>{fmtGWh(r.commonMWh)}</td><td>{fmtGWh(r.dayMWh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </ChartBlock>
  );
}
