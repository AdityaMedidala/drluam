import { Accordion, AccordionItem, Tile } from "@carbon/react";
import { useEffect, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Customized, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AccuracyResponse } from "../api";
import { fmtDate, fmtGWNumber, fmtMW, fmtPct, fmtSignedMW, gwAxis } from "../format";
import { useChartColors, type ChartColors } from "../theme";
import { ChartFrame, ChartLegend, ChartTooltip, ErrorState, Loading, plotFrame, xAxisProps, yAxisProps, type TableSpec } from "./ui";

/** "How far can we trust the forecast?" across all January decisions. */
export default function AccuracyView({ cutoff }: { cutoff: string }) {
  const c = useChartColors();
  const [data, setData] = useState<AccuracyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Charts in a collapsed accordion would render at 0×0; mount them only once it opens.
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.accuracy(cutoff).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [cutoff]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading height={420} />;

  const { raw, comparison: cmp, band } = data;
  const improvement = 1 - cmp.adjusted.mae / cmp.raw.mae;
  const biasRemoved = 1 - cmp.adjusted.bias / cmp.raw.bias;
  const calibration = data.planCalibration;
  const hasDev = calibration.some((r) => r.developmentHitRate != null);
  const p90 = calibration.find((r) => r.confidence === 90);
  const p90Pooled = p90?.developmentHitRate != null;
  const daily = data.daily.map((d) => ({
    ...d, label: fmtDate(d.deliveryDate), short: fmtDate(d.deliveryDate).split(" ").slice(1).join(" "), gap: [d.actual, d.forecast],
  }));
  const hist = data.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  const pct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`);
  const ax = xAxisProps(c);
  const dailyX = { dataKey: "short", interval: "equidistantPreserveStart" as const, minTickGap: 14, ...ax };

  const tables: Record<string, TableSpec> = {
    top: { columns: [{ label: "Delivery day" }, { label: "NESO forecast, mean (MW)", numeric: true }, { label: "Outturn, mean (MW)", numeric: true }, { label: "Difference (MW)", numeric: true }],
      rows: daily.map((d) => [d.label, d.forecast, d.actual, d.forecast - d.actual]) },
    level: { columns: [{ label: "Forecast level" }, { label: "Hours", numeric: true }, { label: "NESO mean error (MW)", numeric: true }, { label: "Bias-corrected mean error (MW)", numeric: true }],
      rows: data.byLevel.map((r) => [r.group, r.n, r.errorBias, r.adjErrorBias ?? null]) },
    calibration: { columns: [{ label: "Exceedance level" }, { label: "Target" }, { label: "Hit rate, January 2026" }, { label: "Hit rate, Nov 2025 – Sep 2026" }],
      rows: calibration.map((r) => [`P${r.confidence}`, pct(r.target), pct(r.januaryHitRate), pct(r.developmentHitRate)]) },
    dailyMae: { columns: [{ label: "Delivery day" }, { label: "NESO MAE (MW)", numeric: true }, { label: "Bias-corrected MAE (MW)", numeric: true }],
      rows: daily.map((d) => [d.label, d.maeRaw, d.maeAdjusted]) },
    lead: { columns: [{ label: "Lead time" }, { label: "Hours", numeric: true }, { label: "MAE (MW)", numeric: true }, { label: "Mean error (MW)", numeric: true }],
      rows: data.byHorizon.map((r) => [r.group.startsWith("<0h") ? "elapsed" : r.group, r.n, r.errorMae, r.errorBias]) },
    hour: { columns: [{ label: "Hour (UK)" }, { label: "NESO MAE (MW)", numeric: true }, { label: "Bias-corrected MAE (MW)", numeric: true }],
      rows: data.byHour.map((r) => [`${String(r.group).padStart(2, "0")}:00`, r.errorMae, r.adjErrorMae ?? null]) },
    hist: { columns: [{ label: "Error from (MW)", numeric: true }, { label: "Error to (MW)", numeric: true }, { label: "Hours", numeric: true }],
      rows: hist.map((b) => [b.from, b.to, b.count]) },
  };
  const note = "Use Show as table for the values.";

  return (
    <div>
      <Tile className="tile">
        <ChartFrame title="Daily mean wind, forecast vs outturn · GW"
          legend={<ChartLegend items={[{ label: "NESO forecast", color: c.forecast }, { label: "Outturn", color: c.actual }, { label: "Difference", color: c.forecast, kind: "band" }]} />}
          table={tables.top} fileName="daily-mean-forecast-vs-outturn" plotClassName="acc-top-plot"
          ariaLabel={`Daily mean NESO forecast and outturn for January, in GW. ${note}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={c.grid} />
              <XAxis {...dailyX} />
              <YAxis {...gwAxis(daily.flatMap((d) => [d.forecast, d.actual]))} {...yAxisProps(c)} />
              <Customized component={plotFrame(c)} />
              <Tooltip content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip title={payload[0].payload.label} rows={[
                    { label: "NESO forecast", value: fmtMW(payload[0].payload.forecast), color: c.forecast },
                    { label: "Outturn", value: fmtMW(payload[0].payload.actual), color: c.actual },
                    { label: "Difference", value: fmtSignedMW(payload[0].payload.forecast - payload[0].payload.actual) },
                  ]} />
                ) : null} />
              <Area dataKey="gap" stroke="none" fill={c.forecast} fillOpacity={0.18} isAnimationActive={false} />
              <Line dataKey="forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="actual" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Tile>

      <dl className="kpis" aria-label="Headline numbers">
        <div><dt>MAE</dt><dd>{mw(cmp.raw.mae)} → {mw(cmp.adjusted.mae)} MW <span className="kpi-sub">({signedPct(-improvement)})</span></dd></div>
        <div><dt>Mean error</dt><dd>{fmtSignedMW(cmp.raw.bias).replace(" MW", "")} → {fmtSignedMW(cmp.adjusted.bias)} <span className="kpi-sub">({signedPct(-biasRemoved)})</span></dd></div>
        <div><dt>P90 hit rate{p90Pooled ? " (Nov 2025–Sep 2026 backtest)" : " (January 2026)"}</dt>
          <dd>{fmtPct(p90Pooled ? p90?.developmentHitRate : p90?.januaryHitRate)} <span className="kpi-sub">(target 90%)</span></dd></div>
        <div><dt>80% range coverage</dt><dd>{fmtPct(band.coverage)} <span className="kpi-sub">(target 80%)</span></dd></div>
      </dl>

      <div className="three">
        <Tile className="tile">
          <ChartFrame title="Mean error by forecast level · GW"
            legend={<ChartLegend items={[{ label: "NESO forecast", color: c.forecast, kind: "bar" }, { label: "Bias-corrected forecast", color: c.adjusted, kind: "bar" }]} />}
            table={tables.level} fileName="mean-error-by-forecast-level" plotClassName="plot" ariaLabel={`Mean error by forecast level, in GW. ${note}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byLevel} accessibilityLayer barGap={2} margin={{ top: 8, right: 8, bottom: 12, left: 4 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis dataKey="group" tickFormatter={(g: string) => g.replace(" GW", "").replace("-", "–")} interval={0} {...ax}
                  label={{ value: "Forecast level (GW)", position: "insideBottom", offset: -6, fill: c.axis, fontSize: 12 }} height={40} />
                <YAxis {...gwAxis(data.byLevel.flatMap((r) => [r.errorBias, r.adjErrorBias]))} {...yAxisProps(c)} />
                <Customized component={plotFrame(c)} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip cursor={{ fill: c.grid }} content={<GroupTooltip c={c} metric="Bias" />} />
                <Bar dataKey="errorBias" fill={c.forecast} isAnimationActive={false} />
                <Bar dataKey="adjErrorBias" fill={c.adjusted} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Tile>

        <Tile className="tile">
          <ChartFrame title="Exceedance calibration"
            legend={<ChartLegend items={[
              { label: "January 2026", color: c.adjusted }, ...(hasDev ? [{ label: "Nov 2025–Sep 2026", color: c.actual }] : []),
              { label: "Target", color: c.axis, kind: "dash" as const }]} />}
            table={tables.calibration} fileName="exceedance-calibration" plotClassName="plot" ariaLabel={`Hit rate by exceedance level against target, in percent. ${note}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calibration} accessibilityLayer margin={{ top: 8, right: 16, bottom: 12, left: 4 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis type="number" dataKey="target" domain={[0.4, 1]} ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => `${Math.round(v * 100)}`} {...ax}
                  label={{ value: "Target (%)", position: "insideBottom", offset: -6, fill: c.axis, fontSize: 12 }} height={40} />
                <YAxis type="number" domain={[0.4, 1]} ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => `${Math.round(v * 100)}`} {...yAxisProps(c, "Hit rate (%)")} />
                <Customized component={plotFrame(c)} />
                <ReferenceLine segment={[{ x: 0.4, y: 0.4 }, { x: 1, y: 1 }]} stroke={c.axis} strokeDasharray="4 4" ifOverflow="hidden" />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTooltip title={<>P{payload[0].payload.confidence} · target {fmtPct(payload[0].payload.target)}</>} rows={[
                      { label: "Hit rate, January 2026", value: fmtPct(payload[0].payload.januaryHitRate), color: c.adjusted },
                      ...(payload[0].payload.developmentHitRate != null
                        ? [{ label: "Hit rate, Nov 2025 – Sep 2026", value: fmtPct(payload[0].payload.developmentHitRate), color: c.actual }] : []),
                    ]} />
                  ) : null} />
                <Line dataKey="januaryHitRate" stroke={c.adjusted} strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false} />
                {hasDev && <Line dataKey="developmentHitRate" stroke={c.actual} strokeWidth={1.5} dot={squareDot(c.actual)} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Tile>

        <Tile className="tile">
          <ChartFrame title="Daily MAE · GW"
            legend={<ChartLegend items={[{ label: "NESO forecast", color: c.forecast }, { label: "Bias-corrected forecast", color: c.adjusted }]} />}
            table={tables.dailyMae} fileName="daily-mae" plotClassName="plot" ariaLabel={`Daily MAE of the NESO and bias-corrected forecasts, in GW. ${note}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} accessibilityLayer margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis {...dailyX} />
                <YAxis {...gwAxis(daily.flatMap((d) => [d.maeRaw, d.maeAdjusted]))} {...yAxisProps(c)} />
                <Customized component={plotFrame(c)} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTooltip title={payload[0].payload.label} rows={[
                      { label: "NESO MAE", value: fmtMW(payload[0].payload.maeRaw), color: c.forecast },
                      { label: "Bias-corrected MAE", value: fmtMW(payload[0].payload.maeAdjusted), color: c.adjusted },
                    ]} />
                  ) : null} />
                <Line dataKey="maeRaw" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="maeAdjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Tile>
      </div>

      <Accordion className="section-gap">
        <AccordionItem title="More diagnostics" open={diagOpen} onHeadingClick={({ isOpen }: { isOpen: boolean }) => setDiagOpen(isOpen)}>
          {diagOpen && <div className="stack">
            <ChartFrame title="MAE and mean error by lead time · GW" subtitle="All published NESO forecast runs, not only decision-time runs."
              legend={<ChartLegend items={[{ label: "MAE", color: c.forecast }, { label: "Mean error", color: c.forecast, kind: "dash" }]} />}
              table={tables.lead} fileName="error-by-lead-time" plotClassName="diag-plot" ariaLabel={`MAE and mean error by lead time, in GW. ${note}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.byHorizon} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke={c.grid} />
                  <XAxis dataKey="group" tickFormatter={(g) => (g.startsWith("<0h") ? "elapsed" : g)} interval={0} {...ax} />
                  <YAxis {...gwAxis(data.byHorizon.flatMap((r) => [r.errorMae, r.errorBias]))} {...yAxisProps(c)} />
                  <Customized component={plotFrame(c)} />
                  <Tooltip content={<GroupTooltip c={c} rawOnly />} />
                  <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="errorBias" stroke={c.forecast} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
            <ChartFrame title="MAE by hour of day · GW"
              legend={<ChartLegend items={[{ label: "NESO forecast", color: c.forecast }, { label: "Bias-corrected forecast", color: c.adjusted }]} />}
              table={tables.hour} fileName="mae-by-hour" plotClassName="diag-plot" ariaLabel={`MAE by hour of day, in GW. ${note}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.byHour} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke={c.grid} />
                  <XAxis dataKey="group" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval="equidistantPreserveStart" minTickGap={6} {...ax} />
                  <YAxis {...gwAxis(data.byHour.flatMap((r) => [r.errorMae, r.adjErrorMae]))} {...yAxisProps(c)} />
                  <Customized component={plotFrame(c)} />
                  <Tooltip content={<GroupTooltip c={c} metric="MAE" hour />} />
                  <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="adjErrorMae" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
            <ChartFrame title="Error distribution (forecast − outturn) · hours" subtitle="NESO forecast in 500 MW bins. Positive values are over-forecasts."
              table={tables.hist} fileName="error-distribution" plotClassName="diag-plot" ariaLabel={`Hours per error bin of the NESO forecast. ${note}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist} accessibilityLayer barCategoryGap={1} margin={{ top: 8, right: 16, bottom: 12, left: 4 }}>
                  <CartesianGrid stroke={c.grid} />
                  <XAxis dataKey="mid" tickFormatter={fmtGWNumber} ticks={hist.filter((b) => b.mid % 1000 === 0).map((b) => b.mid)} interval="equidistantPreserveStart" {...ax}
                    label={{ value: "Error (GW)", position: "insideBottom", offset: -6, fill: c.axis, fontSize: 12 }} height={40} />
                  <YAxis {...yAxisProps(c, "Hours")} width={52} />
                  <Customized component={plotFrame(c)} />
                  <ReferenceLine x={0} stroke={c.axis} strokeDasharray="3 3" />
                  <Tooltip cursor={{ fill: c.grid }} content={({ active, payload }) =>
                    active && payload?.length ? (
                      <ChartTooltip title={<>{fmtSignedMW(payload[0].payload.from)} to {fmtSignedMW(payload[0].payload.to)}</>}
                        rows={[{ label: "Hours", value: payload[0].payload.count, color: c.forecast }]} />
                    ) : null} />
                  <Bar dataKey="count" fill={c.forecast} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>}
        </AccordionItem>
        <AccordionItem title="Methodology">
          <dl className="methodology">
            <dt>Period</dt>
            <dd>Decisions made in January 2026, for delivery days {fmtDate(data.period.firstDelivery)} to {fmtDate(data.period.lastDelivery)}. Hourly data, {cmp.adjusted.n} hours compared.</dd>
            <dt>NESO forecast</dt>
            <dd>Latest WINDFOR run published by the decision time ({data.cutoff} UK, D-1). Later runs are excluded.</dd>
            <dt>Outturn</dt>
            <dd>FUELHH metered wind generation for the same hour.</dd>
            <dt>Mean error</dt>
            <dd>Forecast minus outturn, averaged. Positive means over-forecast, the risk of under-buying. The NESO forecast was too high in {fmtPct(raw.overForecastShare)} of hours.</dd>
            <dt>MAE</dt>
            <dd>Mean absolute error, the average size of the hourly error in MW. The % change compares the bias-corrected forecast with the NESO forecast.</dd>
            <dt>Bias-corrected forecast</dt>
            <dd>NESO forecast scaled by the previous 7 days’ outturn-to-forecast ratio. Only outturn known at decision time is used. Its daily MAE was lower on {cmp.daysAdjustedBetter} of {cmp.days} days.</dd>
            <dt>Hit rate</dt>
            <dd>Share of hours with outturn at or above the planning volume. Backtest from Nov 2025 to Sep 2026, 7,775 hours. Past performance, not a guarantee.</dd>
            <dt>Under-coverage</dt>
            <dd>P90 missed 16% of hours (target 10%). P95 missed 11% (target 5%). Whole-day shortfalls happen more often than the previous week suggests.</dd>
            <dt>80% range</dt>
            <dd>Bias-corrected forecast plus the 10th to 90th percentile of the previous 7 days’ errors. Coverage counts {band.n} hours.</dd>
            <dt>Forecast level</dt>
            <dd>Hours grouped by the NESO forecast at decision time. Bins are below 5, 5 to 10, 10 to 15 and above 15 GW.</dd>
            <dt>Lead time</dt>
            <dd>Hours from a run’s publication to the delivery hour. Elapsed means the hour had already passed.</dd>
            <dt>Curtailment</dt>
            <dd>Most of the average gap matches accepted balancing-mechanism bids for wind. See the project’s curtailment analysis.</dd>
            <dt>Units and times</dt>
            <dd>UK local time. Power in MW, energy in GWh.</dd>
          </dl>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GroupTooltip({ active, payload, metric, rawOnly, hour, c }: any & { c: ChartColors }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const title = hour ? `${String(p.group).padStart(2, "0")}:00 UK` : p.group;
  const rows = rawOnly
    ? [{ label: "MAE", value: fmtMW(p.errorMae), color: c.forecast }, { label: "Mean error", value: fmtSignedMW(p.errorBias), color: c.forecast }]
    : metric === "Bias"
      ? [{ label: "NESO mean error", value: fmtSignedMW(p.errorBias), color: c.forecast }, { label: "Bias-corrected mean error", value: fmtSignedMW(p.adjErrorBias), color: c.adjusted }]
      : [{ label: "NESO MAE", value: fmtMW(p.errorMae), color: c.forecast }, { label: "Bias-corrected MAE", value: fmtMW(p.adjErrorMae), color: c.adjusted }];
  return <ChartTooltip title={title} rows={[...rows, { label: "Hours", value: p.n }]} />;
}

const mw = (v: number) => Math.round(v).toLocaleString("en-GB");
const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`;

// Square markers keep the second calibration series distinct without relying on colour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const squareDot = (fill: string) => ({ cx, cy, index }: any) =>
  cx == null || cy == null ? <g key={index} /> : <rect key={index} x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={fill} />;
