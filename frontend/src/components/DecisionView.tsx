import { Accordion, AccordionItem, Tile } from "@carbon/react";
import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Customized, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type DayResponse, type DriftResponse, type Meta, type PlanResponse } from "../api";
import { fmtMW, fmtTime, gwAxis } from "../format";
import { useChartColors } from "../theme";
import { adjustedInline, adjustedName, adjustedShort, useModel } from "../model";
import CostPanel from "./CostPanel";
import DriftPanel from "./DriftPanel";
import PlanPanel from "./PlanPanel";
import { ChartFrame, ChartLegend, ChartTooltip, ErrorState, Loading, plotFrame, xAxisProps, yAxisProps, type TableSpec } from "./ui";

/** "What did the desk know when it had to buy?" for one delivery day, fitted to one screen. */
export default function DecisionView({ meta, cutoff, date, confidence, showActual, costs, onCosts, onConfidence }: {
  meta: Meta; cutoff: string; date: string; confidence: number; showActual: boolean;
  costs: { short: number; long: number }; onCosts: (short: number, long: number) => void; onConfidence: (c: number) => void;
}) {
  const c = useChartColors();
  const model = useModel();
  const adj = adjustedName(model);
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
    api.day(date, cutoff, model).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [date, cutoff, model]);
  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlanError(null);
    api.plan(date, cutoff, confidence, model).then((p) => live && setPlan(p)).catch((e) => live && setPlanError(String(e)));
    return () => { live = false; };
  }, [date, cutoff, confidence, model]);
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
  // Hourly ticks in UK time (00:00 … 23:00); Recharts thins them only when they would collide.
  const hourTicks = useMemo(() => chartData.map((p) => p.time).filter((t) => fmtTime(t).endsWith(":00")), [chartData]);
  // One y-domain for the main chart and the drift chart, from 0 to a round value just above the data.
  const yAxis = useMemo(() => gwAxis([
    ...chartData.flatMap((p) => [p.forecast, p.high, p.plan, showActual ? p.actual : null]),
    ...(drift?.runs ?? []).flatMap((r) => r.hours.map((h) => h.forecastMW)),
  ]), [chartData, drift, showActual]);

  const hasCorrection = model === "ml" ? data != null : data?.correctionRatio != null;
  const ratio = data?.correctionRatio ?? null;
  // same source switch as PlanPanel: pooled Nov–Sep backtest where measured, otherwise January at this cutoff
  const pooled = plan?.calibration.find((r) => r.confidence === confidence)?.developmentHitRate != null;
  // Share of hours below a level's planning volume, from the same backtest as the hit rate (pooled where measured).
  const missed = (level: number) => {
    const r = plan?.calibration.find((x) => x.confidence === level);
    const hit = r ? (pooled ? r.developmentHitRate : r.januaryHitRate) : null;
    return hit == null ? "–" : `${Math.round((1 - hit) * 100)}%`;
  };
  // Simple's P90 planning volume is the range's low edge (one column); ML calibrates them separately, so both show.
  const showLow = !(confidence === 90 && model === "simple");
  const legend = [
    { label: "NESO forecast", color: c.forecast },
    ...(hasCorrection ? [{ label: adj, color: c.adjusted }] : []),
    { label: `P${confidence} planning volume`, color: c.plan, kind: "dash" as const },
    ...(hasCorrection ? [{ label: "80% range", color: c.band, kind: "band" as const }] : []),
    ...(hasCorrection && model === "ml" ? [{ label: "80% range low edge", color: c.adjusted }] : []),
    ...(showActual ? [{ label: "Outturn", color: c.actual }] : []),
  ];
  const hourly = chartData.filter((p) => p.forecast != null);
  const table: TableSpec = {
    columns: [
      { label: "Time (UK)" }, { label: "NESO forecast (MW)", numeric: true }, { label: `${adjustedShort(model)} (MW)`, numeric: true },
      { label: `P${confidence} planning volume (MW)`, numeric: true },
      ...(showLow ? [{ label: "80% range low (MW)", numeric: true }] : []), { label: "80% range high (MW)", numeric: true },
      ...(showActual ? [{ label: "Outturn (MW)", numeric: true }] : []),
    ],
    rows: hourly.map((p) => [
      fmtTime(p.time), p.forecast, p.adjusted, p.plan, ...(showLow ? [p.low] : []), p.high, ...(showActual ? [p.actual] : []),
    ]),
  };

  return (
    <>
      <div className="decision">
        <Tile className="tile decision-left">
          <PlanPanel plan={plan} day={data} error={planError} confidence={confidence} showActual={showActual} />
          <CostPanel cutoff={cutoff} short={costs.short} long={costs.long} confidence={confidence}
            onCosts={onCosts} onUseLevel={onConfidence} />
          <DriftPanel drift={drift} error={driftError} c={c} yAxis={yAxis} />
        </Tile>

        <Tile className="tile">
          {error && <ErrorState error={error} />}
          {!data && !error && <Loading height={480} />}
          {data && !error && (
            <ChartFrame title="Hourly wind forecast · GW"
              legend={<ChartLegend items={legend} />} table={table} fileName={`wind-forecast-${data.date}`} plotClassName="main-plot"
              ariaLabel={`Hourly wind forecast in GW for ${data.date}: NESO forecast, ${adjustedInline(model)}, P${confidence} planning volume and 80% range. Use Show as table for the values.`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke={c.grid} />
                  <XAxis dataKey="time" tickFormatter={fmtTime} ticks={hourTicks} interval="equidistantPreserveStart" minTickGap={6} {...xAxisProps(c)} />
                  <YAxis {...yAxis} {...yAxisProps(c)} />
                  <Customized component={plotFrame(c)} />
                  <Tooltip content={<DayTooltip showActual={showActual} confidence={confidence} c={c} adj={adj} />} />
                  {hasCorrection && <Area dataKey="band" stroke="none" fill={c.band} fillOpacity={c.bandOpacity} connectNulls isAnimationActive={false} />}
                  <Line dataKey="forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  {hasCorrection && <Line dataKey="adjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                  {/* ML: the range's low edge as a thin line, under the dashed planning volume (they differ under ML) */}
                  {hasCorrection && model === "ml" && <Line dataKey="low" stroke={c.adjusted} strokeWidth={1} strokeOpacity={0.6} dot={false} connectNulls isAnimationActive={false} />}
                  <Line dataKey="plan" stroke={c.plan} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
                  {showActual && <Line dataKey="actual" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </Tile>
      </div>

      <Accordion className="section-gap">
        <AccordionItem title="Methodology">
          <dl className="methodology">
            <dt>NESO forecast</dt>
            <dd>Latest WINDFOR run published by the decision time ({cutoff} UK, D-1). Later runs are excluded.</dd>
            <dt>Forecast run</dt>
            <dd>Publication time of that run. Lead time is the hours from publication to the first and last delivery hour.</dd>
            <dt>Bias-corrected forecast</dt>
            <dd>NESO forecast scaled by the previous 7 days’ outturn-to-forecast ratio. Only outturn known at decision time is used.{ratio != null ? <> The ratio for this day is {ratio.toFixed(2)}.</> : null}</dd>
            <dt>ML model (LightGBM + CQR)</dt>
            <dd>An optional second model. A LightGBM quantile model reads the same decision-time inputs, including the forecast level, hour, weekday, lead time and last week’s errors. It is retrained monthly on earlier data only. Conformalized quantile regression then recalibrates it on its own errors over the previous 28 days. It is precomputed for January at 09:00 and 09:20. Evidence and limits are in docs/cqr-2024.md and docs/decisions.md.</dd>
            <dt>P{confidence} planning volume</dt>
            <dd>{model === "ml"
              ? <>The ML model’s volume met with {confidence}% probability, recalibrated on its errors over the previous 28 days. Floored at zero and summed over the day.</>
              : <>Hourly bias-corrected forecast plus the {ordinal(100 - confidence)} percentile of the previous 7 days’ hourly errors. Floored at zero and summed over the day.{confidence === 90 ? " Equal to the low edge of the 80% range." : ""}</>}</dd>
            <dt>Δ vs NESO forecast</dt>
            <dd>Planning volume minus NESO forecast. Negative means plan for less wind.</dd>
            <dt>Hit rate</dt>
            <dd>Share of hours with outturn at or above the planning volume. {pooled
              ? "Backtest from Nov 2025 to Sep 2026, 7,775 hours."
              : `January 2026 hours at ${cutoff}. The longer backtest covers the 09:00 and 09:20 decision times only.`} Past performance, not a guarantee.</dd>
            <dt>Cost of being short or long</dt>
            <dd>Desk assumptions in £ per MWh, illustrative. Short means outturn below the planning volume, so the gap is bought late. Long means outturn above it.</dd>
            <dt>Recommended exceedance level</dt>
            <dd>Short cost divided by the sum of both costs. This is the newsvendor critical ratio (Arrow, Harris and Marschak 1951), used for wind by Pinson et al. (2007). It snaps to the nearest offered level, and never below P50.</dd>
            <dt>Cost backtest</dt>
            <dd>Hourly cost is the short cost times MWh short plus the long cost times MWh long. It uses January hours, the same residuals and the same outturn alignment as the hit rate.</dd>
            <dt>Theory vs backtest</dt>
            <dd>The backtest best level can differ from theory. Under-covering tails push it up. Single months are noisy, and the cost curve is flat near the optimum. This is a decision aid, not a validated method change.</dd>
            <dd>Most of the saving comes from the bias correction itself. Level choice adds a smaller refinement.</dd>
            <dt>Under-coverage</dt>
            <dd>P90 missed {missed(90)} of hours (target 10%). P95 missed {missed(95)} (target 5%).{model === "simple" ? " Whole-day shortfalls happen more often than the previous week suggests." : ""}</dd>
            <dt>80% range</dt>
            <dd>{model === "ml"
              ? "The ML model’s 10th to 90th percentile, widened or narrowed by its errors over the previous 28 days."
              : "Bias-corrected forecast plus the 10th to 90th percentile of the same errors."}</dd>
            {model === "ml" && <dd>Under ML the P90 planning volume and the range’s low edge differ. The range uses two-sided calibration and each planning volume one-sided calibration.</dd>}
            <dt>Forecast revisions</dt>
            <dd>All runs published before the decision time, compared on the hours every run covers.</dd>
            <dt>Outturn</dt>
            <dd>FUELHH metered wind generation, half-hourly. Hidden by default.</dd>
            <dt>Curtailment</dt>
            <dd>Most of the average gap matches accepted balancing-mechanism bids for wind. See the project’s curtailment analysis.</dd>
            <dt>Units and times</dt>
            <dd>UK local time. Power in MW, energy in GWh.</dd>
          </dl>
        </AccordionItem>
      </Accordion>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, showActual, confidence, c, adj }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows = [
    p.forecast != null && { label: "NESO forecast", value: fmtMW(p.forecast), color: c.forecast },
    p.adjusted != null && { label: adj, value: fmtMW(p.adjusted), color: c.adjusted },
    p.plan != null && { label: `P${confidence} planning volume`, value: fmtMW(p.plan), color: c.plan },
    p.low != null && { label: "80% range", value: `${fmtMW(p.low)} – ${fmtMW(p.high)}`, color: c.band },
    showActual && p.actual != null && { label: "Outturn", value: fmtMW(p.actual), color: c.actual },
  ].filter(Boolean);
  return <ChartTooltip title={`${fmtTime(p.time)} UK`} rows={rows} />;
}

/** 10 -> "10th", 5 -> "5th", 50 -> "50th", 30 -> "30th", 20 -> "20th". */
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
