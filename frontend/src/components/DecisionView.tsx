import {
  Accordion, AccordionItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tile,
} from "@carbon/react";
import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type DayResponse, type DriftResponse, type Meta, type PlanResponse } from "../api";
import { fmtDateTime, fmtMW, fmtTime, gwAxis } from "../format";
import { useChartColors } from "../theme";
import DriftPanel from "./DriftPanel";
import PlanPanel from "./PlanPanel";
import { ChartLegend, ChartTooltip, ErrorState, Loading } from "./ui";

/** "What did the desk know when it had to buy?" for one delivery day, fitted to one screen. */
export default function DecisionView({ meta, cutoff, date, confidence, showActual }: {
  meta: Meta; cutoff: string; date: string; confidence: number; showActual: boolean;
}) {
  const c = useChartColors();
  const [data, setData] = useState<DayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);
  void meta;

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

  const chartData = useMemo(() => {
    const planAt = new Map((plan?.hours ?? []).map((h) => [h.time, h.planMW]));
    return data?.series.map((p) => ({
      ...p,
      plan: planAt.get(p.time) ?? null,
      band: p.low != null && p.high != null ? [p.low, p.high] : null,
    })) ?? [];
  }, [data, plan]);
  // Ticks every 6 h in UK time: readable at phone width and correct on clock-change days.
  const sixHourTicks = useMemo(
    () => chartData.map((p) => p.time).filter((t) => ["00:00", "06:00", "12:00", "18:00"].includes(fmtTime(t))),
    [chartData],
  );
  // One y-domain for the main chart and the drift chart, from 0 to a round value just above the data.
  const yAxis = useMemo(() => gwAxis([
    ...chartData.flatMap((p) => [p.forecast, p.high, p.plan, showActual ? p.actual : null]),
    ...(drift?.runs ?? []).flatMap((r) => r.hours.map((h) => h.forecastMW)),
  ]), [chartData, drift, showActual]);

  const hasCorrection = data?.correctionRatio != null;
  const ratio = data?.correctionRatio ?? null;
  const showLow = confidence !== 90;   // at P90 the planning volume is the range's low edge: one column, not two
  const legend = [
    { label: "NESO forecast", color: c.forecast },
    ...(hasCorrection ? [{ label: "Bias-corrected forecast", color: c.adjusted }] : []),
    { label: `P${confidence} planning volume`, color: c.plan, kind: "dash" as const },
    ...(hasCorrection ? [{ label: "80% range", color: c.band, kind: "band" as const }] : []),
    ...(showActual ? [{ label: "Outturn", color: c.actual }] : []),
  ];

  return (
    <>
      <div className="decision">
        <Tile className="tile decision-left">
          <PlanPanel plan={plan} day={data} error={planError} confidence={confidence} showActual={showActual} />
          <DriftPanel drift={drift} error={driftError} c={c} yAxis={yAxis} />
        </Tile>

        <Tile className="tile">
          {error && <ErrorState error={error} />}
          {!data && !error && <Loading height={480} />}
          {data && !error && (
            <>
              <h2 className="chart-title">Hourly wind forecast · MW</h2>
              <p className="sub">Forecasts at decision time, planning volume and 80% range for the delivery day.</p>
              <ChartLegend items={legend} />
              <div className="main-plot" role="img" aria-label={`Hourly wind forecast in MW for ${data.date}: NESO forecast, bias-corrected forecast, P${confidence} planning volume and 80% range. Values are in the data table below.`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="time" tickFormatter={fmtTime} ticks={sixHourTicks} stroke={c.axis} tickLine={false} fontSize={12} />
                    <YAxis {...yAxis} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                    <Tooltip content={<DayTooltip showActual={showActual} confidence={confidence} c={c} />} />
                    {hasCorrection && <Area dataKey="band" stroke="none" fill={c.band} fillOpacity={c.bandOpacity} connectNulls isAnimationActive={false} />}
                    <Line dataKey="forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                    {hasCorrection && <Line dataKey="adjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                    <Line dataKey="plan" stroke={c.plan} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
                    {showActual && <Line dataKey="actual" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Tile>
      </div>

      <Accordion className="section-gap">
        <AccordionItem title="Data tables">
          {data && (
            <Table size="sm" aria-label="Hourly forecast for the delivery day, MW" className="num-table">
              <TableHead><TableRow>
                <TableHeader>Time (UK)</TableHeader><TableHeader>NESO forecast (MW)</TableHeader><TableHeader>Bias-corrected (MW)</TableHeader>
                <TableHeader>P{confidence} planning volume (MW)</TableHeader>
                {showLow && <TableHeader>80% range low (MW)</TableHeader>}<TableHeader>80% range high (MW)</TableHeader>
                {showActual && <TableHeader>Outturn (MW)</TableHeader>}
              </TableRow></TableHead>
              <TableBody>
                {chartData.filter((p) => p.forecast != null).map((p) => (
                  <TableRow key={p.time}>
                    <TableCell>{fmtTime(p.time)}</TableCell><TableCell>{num(p.forecast)}</TableCell><TableCell>{num(p.adjusted)}</TableCell>
                    <TableCell>{num(p.plan)}</TableCell>{showLow && <TableCell>{num(p.low)}</TableCell>}<TableCell>{num(p.high)}</TableCell>
                    {showActual && <TableCell>{num(p.actual)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {drift && (
            <Table size="sm" aria-label="Forecast runs for the delivery day, GWh" className="num-table section-gap">
              <TableHead><TableRow>
                <TableHeader>Run published (UK)</TableHeader><TableHeader>Hours of the day</TableHeader>
                <TableHeader>Total, common {drift.commonHours} h (GWh)</TableHeader><TableHeader>Day total (GWh)</TableHeader>
              </TableRow></TableHead>
              <TableBody>
                {drift.runs.map((r) => (
                  <TableRow key={r.publishedUtc}>
                    <TableCell>{fmtDateTime(r.publishedUtc)}{r.isDecisionRun ? " (decision run)" : ""}</TableCell>
                    <TableCell>{r.hours.length}</TableCell><TableCell>{gwh(r.commonMWh)}</TableCell><TableCell>{gwh(r.dayMWh)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AccordionItem>
        <AccordionItem title="Methodology">
          <dl className="methodology">
            <dt>NESO forecast</dt>
            <dd>For each hour, the latest WINDFOR forecast (Elexon BMRS) published at or before the decision time ({cutoff} UK on D-1). Later runs are excluded: they were not available at decision time.</dd>
            <dt>Forecast run and horizon</dt>
            <dd>The publication time of that latest run, and its lead time: hours from publication to the first and last delivery hour of the day, rounded outward to whole hours.</dd>
            <dt>Bias-corrected forecast</dt>
            <dd>NESO forecast × the ratio of outturn to forecast over the previous 7 days, using only outturn known at decision time{ratio != null ? <> (this day: {ratio.toFixed(2)})</> : null}.</dd>
            <dt>P{confidence} planning volume</dt>
            <dd>Each hour's bias-corrected forecast + the {100 - confidence}th percentile of the previous 7 days' hourly errors (outturn − bias-corrected, either sign), floored at 0, summed over the day. At P90 it equals the low edge of the 80% range.</dd>
            <dt>Δ vs NESO forecast</dt>
            <dd>Planning volume − NESO forecast, daily energy. Negative = plan for less wind than the NESO forecast.</dd>
            <dt>Hit rate (backtest)</dt>
            <dd>Share of hours with outturn at or above the planning volume (target = the exceedance level). Nov 2025 – Sep 2026 (7,775 hours) uses the same method offline and is shown for the 09:00/09:20 decision times only; January 2026 uses this app's data. P90 was missed in 16% of hours (target 10%), P95 in 11% (target 5%): whole-day shortfalls occur more often than the previous week's errors imply. Past performance, not a guarantee.</dd>
            <dt>80% range</dt>
            <dd>Bias-corrected forecast + the 10th–90th percentile of the same hourly errors.</dd>
            <dt>Forecast revisions</dt>
            <dd>Every WINDFOR run published up to the decision time for this day's hours, compared on the hours all runs cover (D-2 runs end before the last hours). Both charts share one y-axis.</dd>
            <dt>Outturn</dt>
            <dd>FUELHH metered wind generation, half-hourly. Hidden by default so the view shows only information available at decision time.</dd>
            <dt>Curtailment</dt>
            <dd>Most of the average gap matches wind curtailment (accepted balancing-mechanism bids). This is documented in the project's curtailment analysis, which uses data outside this app.</dd>
            <dt>Units and times</dt>
            <dd>UK local time. Power in MW (hourly values); energy in GWh, whole numbers: hourly MW × 1 h (forecasts), half-hourly MW × 0.5 h (outturn).</dd>
          </dl>
        </AccordionItem>
      </Accordion>
    </>
  );
}

const num = (mw: number | null | undefined) => (mw == null ? "–" : Math.round(mw).toLocaleString("en-GB"));
const gwh = (mwh: number | null | undefined) => (mwh == null ? "–" : Math.round(mwh / 1000).toLocaleString("en-GB"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, showActual, confidence, c }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows = [
    p.forecast != null && { label: "NESO forecast", value: fmtMW(p.forecast), color: c.forecast },
    p.adjusted != null && { label: "Bias-corrected forecast", value: fmtMW(p.adjusted), color: c.adjusted },
    p.plan != null && { label: `P${confidence} planning volume`, value: fmtMW(p.plan), color: c.plan },
    p.low != null && { label: "80% range", value: `${fmtMW(p.low)} – ${fmtMW(p.high)}`, color: c.band },
    showActual && p.actual != null && { label: "Outturn", value: fmtMW(p.actual), color: c.actual },
  ].filter(Boolean);
  return <ChartTooltip title={`${fmtTime(p.time)} UK`} rows={rows} />;
}
