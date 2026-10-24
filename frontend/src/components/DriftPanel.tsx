import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DriftResponse } from "../api";
import { fmtMW, fmtTime, gwAxis } from "../format";
import type { ChartColors } from "../theme";
import { ChartLegend, ChartTooltip, ErrorState, Loading } from "./ui";

/** Compact: how the forecast for this delivery day moved across the runs published up to the cutoff. */
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
  const ticks = useMemo(
    () => rows.map((r) => String(r.time)).filter((t) => ["00:00", "12:00"].includes(fmtTime(t))),
    [rows],
  );

  if (error) return <div className="drift"><ErrorState error={error} /></div>;
  if (!drift) return <div className="drift"><Loading height={150} /></div>;
  if (runs.length === 0) return <div className="drift"><p className="label">No forecast runs before the decision time for this day.</p></div>;

  const last = runs.length - 1;

  return (
    <section className="drift" aria-label="Forecast drift">
      <h2 className="chart-title">Forecast revisions to decision time</h2>
      <p className="sub">{runs.length} NESO forecast runs for this day, MW.</p>
      <ChartLegend items={[{ label: "Earlier runs", color: c.axis }, { label: "Decision run", color: c.forecast }]} />
      <div className="drift-plot" role="img" aria-label={`${runs.length} NESO forecast runs for this day, first to decision run; values in the Data tables section.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="time" tickFormatter={fmtTime} ticks={ticks} stroke={c.axis} tickLine={false} fontSize={12} />
            <YAxis {...yAxis} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
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
      </div>
    </section>
  );
}
