import { useEffect, useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type DayResponse, type DriftResponse, type Meta, type PlanResponse } from "../api";
import { gwAxis, fmtGWh, fmtMW, fmtPct, fmtTime, shiftDate } from "../format";
import { useChartColors } from "../theme";
import { readParam, writeParam } from "../url";
import DriftPanel from "./DriftPanel";
import PlanPanel, { CONFIDENCES } from "./PlanPanel";
import { ChartBlock, ChartTooltip, ErrorState, Loading, endLabel, lastIndex, sourceLine } from "./ui";

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
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

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

  useEffect(() => {
    let live = true;
    setDrift(null);
    setDriftError(null);
    api.drift(date, cutoff).then((d) => live && setDrift(d)).catch((e) => live && setDriftError(String(e)));
    return () => { live = false; };
  }, [date, cutoff]);

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
  const shown = (data?.series ?? []).map((p) => (hasCorrection ? p.adjusted : p.forecast)).filter((v): v is number => v != null);
  const gw = (mw: number) => (mw / 1000).toFixed(1);
  const ratio = data?.correctionRatio;

  return (
    <div className="view">
      <div className="controls">
        <div className="date-nav">
          <button className="btn" onClick={() => setDate(shiftDate(date, -1))} disabled={date <= meta.firstDelivery} aria-label="Previous day">‹</button>
          <label className="field">
            Delivery day
            <input type="date" value={date} min={meta.firstDelivery} max={meta.lastDelivery}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <button className="btn" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= meta.lastDelivery} aria-label="Next day">›</button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
          Show what actually happened
        </label>
      </div>

      <PlanPanel plan={plan} day={data} error={planError} confidence={confidence} onConfidence={setConfidence} />

      {error && <ErrorState error={error} />}
      {!data && !error && <Loading rows={2} />}
      {data && !error && (
        <>
          <ChartBlock
            title={shown.length ? `${hasCorrection ? "Adjusted" : "Raw"} forecast ranges ${gw(Math.min(...shown))}–${gw(Math.max(...shown))} GW` : "No forecast for this day"}
            subtitle={showActual
              ? <>In hindsight, {fmtGWh(data.summary.actualEnergyMWh)} of wind came in.</>
              : hasCorrection ? <>Shaded range held the actual in {coverage} of January hours.</> : undefined}
            source={sourceLine(cutoff)}>
            <div className="h-lg">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 112, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="time" tickFormatter={fmtTime} ticks={sixHourTicks} stroke={c.axis} tickLine={false} fontSize={12} />
                  <YAxis {...gwAxis(chartData.flatMap((p) => [p.forecast, p.high, showActual ? p.actual : null]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                  <Tooltip content={<DayTooltip showActual={showActual} c={c} />} />
                  {hasCorrection && <Area dataKey="band" stroke="none" fill={c.band} fillOpacity={c.bandOpacity} connectNulls isAnimationActive={false} />}
                  {hasCorrection && <Line dataKey="low" stroke="none" dot={false} connectNulls isAnimationActive={false} legendType="none"
                    label={endLabel("P10–P90 range", c.adjusted, lastIndex(chartData, "low"))} />}
                  <Line dataKey="forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false}
                    label={endLabel("Raw forecast", c.forecast, lastIndex(chartData, "forecast"), -4)} />
                  {hasCorrection && <Line dataKey="adjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false}
                    label={endLabel("Adjusted", c.adjusted, lastIndex(chartData, "adjusted"), 10)} />}
                  {showActual && <Line dataKey="actual" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false}
                    label={endLabel("Actual", c.actual, lastIndex(chartData, "actual"))} />}
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
          </ChartBlock>

          <DriftPanel drift={drift} error={driftError} c={c} />
        </>
      )}

      <details className="section methodology">
        <summary>Methodology</summary>
        <ul>
          <li><strong>Raw forecast:</strong> for each hour, the latest Elexon WINDFOR forecast published at or before the decision cutoff ({cutoff} UK the day before). Later forecasts are ignored: the desk couldn't have seen them in time.</li>
          <li><strong>Expected (adjusted):</strong> raw forecast × the ratio of actual to forecast wind over the previous 7 days, using only actuals already known at the cutoff{ratio != null ? <> (for this day: {ratio.toFixed(2)})</> : null}.</li>
          <li><strong>Plan on P{confidence}:</strong> each hour's adjusted forecast + the {100 - confidence}th percentile of the last 7 days' hourly misses (actual − adjusted, positive or negative), never below 0, summed over the day. The difference from the raw forecast is raw − plan.</li>
          <li><strong>Held:</strong> the share of past hours whose actual came in at or above the plan. Nov 2025 – Sep 2026 (7,775 hours) comes from the same method run offline on those months and is shown at the 09:00/09:20 cutoffs only; January 2026 is this app's data. The cautious plans over-promise: P90 was missed in 16% of hours (promised 10%), P95 in 11% (promised 5%), because whole-day shortfalls are more frequent than the previous week's errors suggest. Past results, not a guarantee.</li>
          <li><strong>Range:</strong> the adjusted forecast + the 10th–90th percentile of the same misses.</li>
          <li><strong>Forecast drift:</strong> every WINDFOR run published up to the cutoff for this day's hours; runs are compared on the hours they all cover, because runs two days ahead stop short of the last hours.</li>
          <li><strong>Hindsight:</strong> FUELHH metered wind output, half-hourly, hidden by default so the view shows only what was known at decision time.</li>
          <li>Most of the average gap matches wind curtailment (accepted bids) — see docs/curtailment-check.md; that analysis uses data outside this app.</li>
          <li>Times are UK local time. Energy totals: hourly MW × 1 h (forecasts), half-hourly MW × 0.5 h (actuals).</li>
        </ul>
      </details>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, showActual, c }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows = [
    p.forecast != null && { label: "Raw forecast", value: fmtMW(p.forecast), color: c.forecast },
    p.adjusted != null && { label: "Adjusted", value: fmtMW(p.adjusted), color: c.adjusted },
    p.low != null && { label: "P10–P90", value: `${fmtMW(p.low)} – ${fmtMW(p.high)}`, color: c.band },
    showActual && p.actual != null && { label: "Actual", value: fmtMW(p.actual), color: c.actual },
  ].filter(Boolean);
  return <ChartTooltip title={`${fmtTime(p.time)} UK`} rows={rows} />;
}
