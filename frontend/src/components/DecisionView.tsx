import { useEffect, useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type DayResponse, type Meta, type PlanResponse } from "../api";
import { fmtAxisGW, fmtDate, fmtDateTime, fmtGWh, fmtMW, fmtPct, fmtTime, shiftDate } from "../format";
import { useChartColors } from "../theme";
import { readParam, writeParam } from "../url";
import PlanPanel, { CONFIDENCES } from "./PlanPanel";
import { ChartCard, ErrorState, LegendItem, Loading, StatTile } from "./ui";

function initialDate(meta: Meta) {
  const d = readParam("date");
  return d && d >= meta.firstDelivery && d <= meta.lastDelivery ? d : meta.lastDelivery;
}

function initialConfidence() {
  const c = Number(readParam("confidence"));
  return CONFIDENCES.includes(c) ? c : 80;
}

/** "What did the desk know when it had to buy, and how did it turn out?" for one delivery day. */
export default function DecisionView({ meta, cutoff }: { meta: Meta; cutoff: string }) {
  const c = useChartColors();
  const [date, setDate] = useState(() => initialDate(meta));
  const [confidence, setConfidence] = useState(initialConfidence);
  // Off by default so the view shows only what was known at decision time; ?actual=1 turns it on.
  const [showActual, setShowActual] = useState(() => readParam("actual") === "1");
  const [data, setData] = useState<DayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => { writeParam("date", date); }, [date]);
  useEffect(() => { writeParam("confidence", String(confidence)); }, [confidence]);
  useEffect(() => { writeParam("actual", showActual ? "1" : null); }, [showActual]);

  useEffect(() => {
    let live = true;
    setData(null);   // never show the previous day's numbers under a new date or cutoff
    setError(null);
    api.day(date, cutoff).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [date, cutoff]);

  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlanError(null);
    api.plan(date, cutoff, confidence).then((p) => live && setPlan(p)).catch((e) => live && setPlanError(String(e)));
    return () => { live = false; };
  }, [date, cutoff, confidence]);

  const chartData = useMemo(
    () => data?.series.map((p) => ({ ...p, band: p.low != null && p.high != null ? [p.low, p.high] : null })) ?? [],
    [data],
  );
  // Ticks every 6 h in UK time: readable at phone width and correct on clock-change days.
  const sixHourTicks = useMemo(
    () => chartData.map((p) => p.time).filter((t) => ["00:00", "06:00", "12:00", "18:00"].includes(fmtTime(t))),
    [chartData],
  );
  const hasCorrection = data?.correctionRatio != null;
  const coverage = data?.bandCoverage != null ? fmtPct(data.bandCoverage) : "–";

  return (
    <div className="view">
      <div className="controls">
        <div className="date-nav">
          <button onClick={() => setDate(shiftDate(date, -1))} disabled={date <= meta.firstDelivery} aria-label="Previous day">‹</button>
          <label>
            <span className="muted">Delivery day</span>
            <input type="date" value={date} min={meta.firstDelivery} max={meta.lastDelivery}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= meta.lastDelivery} aria-label="Next day">›</button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
          Show what actually happened
        </label>
      </div>

      {data && !error && (
        <p className="decision-context">
          Decision for <strong>{fmtDate(data.date)}</strong>
          {" · "}made {data.decisionTimeUtc ? fmtDateTime(data.decisionTimeUtc) : "–"} UK
          {" · "}<span title="Hours from the forecast's publish time to the first and last delivery hour of the day">
            using forecast published {data.forecastPublishedUtc ? fmtTime(data.forecastPublishedUtc) : "–"}
            {data.horizonHours ? ` (${data.horizonHours[0]}–${data.horizonHours[1]} h ahead)` : ""}
          </span>
        </p>
      )}

      <PlanPanel plan={plan} day={data} error={planError} confidence={confidence} onConfidence={setConfidence} />

      {error && <ErrorState error={error} />}
      {!data && !error && <Loading />}
      {data && !error && (
        <>
          {showActual && (
            <div className="tiles">
              <StatTile label="What actually happened"
                value={fmtGWh(data.summary.actualEnergyMWh)}
                sub={<>Sum of half-hourly FUELHH wind output · average hourly error (MAE) this day: raw {fmtMW(data.summary.maeRaw)} · adjusted {fmtMW(data.summary.maeAdjusted)}</>} />
            </div>
          )}

          <ChartCard wide
            title="National wind generation forecast"
            subtitle={<>Forecast available at decision time, hourly · band = adjusted forecast + P10–P90 of the last 7 days' misses (actual − adjusted forecast) · in January the actual landed inside it in <strong>{coverage}</strong> of hours (not 80%)</>}
            legend={<>
              <LegendItem color={c.forecast} label="Raw forecast" />
              {hasCorrection && <LegendItem color={c.adjusted} label="Adjusted forecast" />}
              {hasCorrection && <LegendItem color={c.band} label={`Band (held ${coverage} of hours)`} band />}
              {showActual && <LegendItem color={c.actual} label="Actual (half-hourly)" />}
            </>}>
            <div className="chart-lg">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="time" tickFormatter={fmtTime} ticks={sixHourTicks} stroke={c.axis} tickLine={false} fontSize={12} />
                  <YAxis tickFormatter={fmtAxisGW} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} domain={[0, "auto"]} />
                  <Tooltip content={<DayTooltip showActual={showActual} />} />
                  {hasCorrection && <Area dataKey="band" stroke="none" fill={c.band} fillOpacity={0.14} connectNulls isAnimationActive={false} />}
                  <Line dataKey="forecast" stroke={c.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  {hasCorrection && <Line dataKey="adjusted" stroke={c.adjusted} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
                  {showActual && <Line dataKey="actual" stroke={c.actual} strokeWidth={2} dot={false} isAnimationActive={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details className="table-toggle">
              <summary>View as table</summary>
              <table>
                <thead><tr><th>Time (UK)</th><th>Raw forecast</th><th>Adjusted</th><th>P10</th><th>P90</th>{showActual && <th>Actual</th>}</tr></thead>
                <tbody>
                  {data.series.filter((p) => p.forecast != null).map((p) => (
                    <tr key={p.time}>
                      <td>{fmtTime(p.time)}</td><td>{fmtMW(p.forecast)}</td><td>{fmtMW(p.adjusted)}</td>
                      <td>{fmtMW(p.low)}</td><td>{fmtMW(p.high)}</td>{showActual && <td>{fmtMW(p.actual)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </ChartCard>
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, showActual }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{fmtTime(p.time)} UK</div>
      {p.forecast != null && <Row label="Raw forecast" value={fmtMW(p.forecast)} />}
      {p.adjusted != null && <Row label="Adjusted" value={fmtMW(p.adjusted)} />}
      {p.low != null && <Row label="P10–P90" value={`${fmtMW(p.low)} – ${fmtMW(p.high)}`} />}
      {showActual && p.actual != null && <Row label="Actual" value={fmtMW(p.actual)} />}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="tooltip-row"><span>{label}</span><strong>{value}</strong></div>
);
