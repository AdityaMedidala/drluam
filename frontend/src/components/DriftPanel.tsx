import { useMemo } from "react";
import { CartesianGrid, Customized, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DriftResponse } from "../api";
import { fmtDateTime, fmtMW, fmtTime, gwAxis } from "../format";
import type { ChartColors } from "../theme";
import { ChartFrame, ChartLegend, ChartTooltip, ErrorState, Loading, plotFrame, xAxisProps, yAxisProps, type TableSpec } from "./ui";

/** Compact: how the forecast for this delivery day moved across the runs published up to the decision time. */
export default function DriftPanel({ drift, error, c, yAxis }: {
  drift: DriftResponse | null; error: string | null; c: ChartColors; yAxis: ReturnType<typeof gwAxis>;
}) {
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

  if (error) return <div className="drift"><ErrorState error={error} /></div>;
  if (!drift) return <div className="drift"><Loading height={150} /></div>;
  if (runs.length === 0) return <div className="drift"><p className="label">No forecast runs before the decision time for this day.</p></div>;

  const last = runs.length - 1;
  const gwh = (mwh: number | null) => (mwh == null ? null : Math.round(mwh / 1000));
  const table: TableSpec = {
    columns: [{ label: "Run published (UK)" }, { label: "Hours of the day", numeric: true },
      { label: `Total, common ${drift.commonHours} h (GWh)`, numeric: true }, { label: "Day total (GWh)", numeric: true }],
    rows: runs.map((r) => [`${fmtDateTime(r.publishedUtc)}${r.isDecisionRun ? " (decision run)" : ""}`, r.hours.length, gwh(r.commonMWh), gwh(r.dayMWh)]),
  };

  return (
    <section className="drift" aria-label="Forecast revisions">
      <ChartFrame title="Forecast revisions · GW" subtitle={`${runs.length} runs published by the decision time.`}
        legend={<ChartLegend items={[{ label: "Earlier runs", color: c.axis }, { label: "Decision run", color: c.forecast }]} />}
        table={table} fileName={`forecast-runs-${drift.date}`} plotClassName="drift-plot"
        ariaLabel={`${runs.length} NESO forecast runs for this day, first to decision run. Use Show as table for the values.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} accessibilityLayer margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={c.grid} />
            <XAxis dataKey="time" tickFormatter={fmtTime} interval="equidistantPreserveStart" minTickGap={6} {...xAxisProps(c)} />
            <YAxis {...yAxis} {...yAxisProps(c)} />
            <Customized component={plotFrame(c)} />
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
                strokeOpacity={r.isDecisionRun ? 1 : 0.2 + 0.45 * (i / Math.max(1, last))} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </section>
  );
}
