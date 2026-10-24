import { Accordion, AccordionItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tile } from "@carbon/react";
import { useEffect, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AccuracyResponse } from "../api";
import { fmtAxisGW, fmtDate, fmtMW, fmtPct, fmtSignedMW, gwAxis } from "../format";
import { useChartColors, type ChartColors } from "../theme";
import { ChartTooltip, ErrorState, Loading, endLabel, lastIndex } from "./ui";

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
  const lastLevel = data.byLevel.length - 1;

  return (
    <div>
      <Tile className="tile">
        <h2 className="chart-title">Daily mean wind: forecast vs outturn</h2>
        <p className="sub">NESO forecast at decision time and metered outturn, daily mean, MW; shading = difference.</p>
        <div className="acc-top-plot">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 8, right: 104, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis dataKey="short" stroke={c.axis} tickLine={false} fontSize={12} interval="preserveStartEnd" minTickGap={32} />
              <YAxis {...gwAxis(daily.flatMap((d) => [d.forecast, d.actual]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
              <Tooltip content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip title={payload[0].payload.label} rows={[
                    { label: "NESO forecast", value: fmtMW(payload[0].payload.forecast), color: c.forecast },
                    { label: "Outturn", value: fmtMW(payload[0].payload.actual), color: c.actual },
                    { label: "Gap", value: fmtSignedMW(payload[0].payload.forecast - payload[0].payload.actual) },
                  ]} />
                ) : null} />
              <Area dataKey="gap" stroke="none" fill={c.forecast} fillOpacity={0.15} isAnimationActive={false} />
              <Line dataKey="forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                label={endLabel("NESO forecast", c.text.forecast, daily.length - 1, -6)} />
              <Line dataKey="actual" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false}
                label={endLabel("Outturn", c.text.actual, daily.length - 1, 10)} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
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
          <h2 className="chart-title">Mean error by forecast level</h2>
          <p className="sub">NESO and bias-corrected forecasts by forecast-level bin, MW.</p>
          <div className="plot">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byLevel} barGap={2} margin={{ top: 24, right: 92, bottom: 12, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" tickFormatter={(g: string) => g.replace(" GW", "").replace("-", "–")} stroke={c.axis} tickLine={false} fontSize={12} interval={0}
                  label={{ value: "Forecast level (GW)", position: "insideBottom", offset: -2, fill: c.axis, fontSize: 12 }} height={40} />
                <YAxis {...gwAxis(data.byLevel.flatMap((r) => [r.errorBias, r.adjErrorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip cursor={{ fill: c.grid }} content={<GroupTooltip c={c} metric="Bias" />} />
                <Bar dataKey="errorBias" fill={c.forecast} isAnimationActive={false}>
                  <LabelList content={barLabel("NESO", c.text.forecast, lastLevel, "end")} />
                </Bar>
                <Bar dataKey="adjErrorBias" fill={c.adjusted} isAnimationActive={false}>
                  <LabelList content={barLabel("Bias-corrected", c.text.adjusted, lastLevel, "start")} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Tile>

        <Tile className="tile">
          <h2 className="chart-title">Exceedance calibration</h2>
          <p className="sub">Hit rate by exceedance level against its target (dashed).</p>
          <div className="plot">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calibration} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis type="number" dataKey="target" domain={[0.4, 1]} ticks={[0.5, 0.7, 0.9]} tickFormatter={(v) => fmtPct(v)}
                  stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis type="number" domain={[0.4, 1]} ticks={[0.4, 0.6, 0.8, 1]} tickFormatter={(v) => fmtPct(v)}
                  stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={44} />
                <ReferenceLine segment={[{ x: 0.4, y: 0.4 }, { x: 1, y: 1 }]} stroke={c.axis} strokeDasharray="4 4" ifOverflow="hidden" />
                <ReferenceDot x={0.43} y={0.43} r={0} label={{ value: "Target", position: "right", offset: 8, fill: c.axis, fontSize: 12 }} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTooltip title={<>P{payload[0].payload.confidence} · target {fmtPct(payload[0].payload.target)}</>} rows={[
                      { label: "Hit rate, January 2026", value: fmtPct(payload[0].payload.januaryHitRate), color: c.adjusted },
                      ...(payload[0].payload.developmentHitRate != null
                        ? [{ label: "Hit rate, Nov 2025 – Sep 2026", value: fmtPct(payload[0].payload.developmentHitRate), color: c.actual }] : []),
                    ]} />
                  ) : null} />
                <Line dataKey="januaryHitRate" stroke={c.adjusted} strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false}
                  label={endLabel("January", c.text.adjusted, calibration.length - 1, 12)} />
                {hasDev && <Line dataKey="developmentHitRate" stroke={c.actual} strokeWidth={1.5} dot={squareDot(c.actual)} isAnimationActive={false}
                  label={endLabel("Nov–Sep", c.text.actual, calibration.length - 1, -6)} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tile>

        <Tile className="tile">
          <h2 className="chart-title">Daily MAE</h2>
          <p className="sub">NESO and bias-corrected forecasts, per delivery day, MW.</p>
          <div className="plot">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 8, right: 104, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="short" stroke={c.axis} tickLine={false} fontSize={12} interval="preserveStartEnd" minTickGap={32} />
                <YAxis {...gwAxis(daily.flatMap((d) => [d.maeRaw, d.maeAdjusted]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTooltip title={payload[0].payload.label} rows={[
                      { label: "NESO MAE", value: fmtMW(payload[0].payload.maeRaw), color: c.forecast },
                      { label: "Bias-corrected MAE", value: fmtMW(payload[0].payload.maeAdjusted), color: c.adjusted },
                    ]} />
                  ) : null} />
                <Line dataKey="maeRaw" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                  label={endLabel("NESO", c.text.forecast, lastIndex(daily, "maeRaw"), -6)} />
                <Line dataKey="maeAdjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false}
                  label={endLabel("Bias-corrected", c.text.adjusted, lastIndex(daily, "maeAdjusted"), 12)} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tile>
      </div>

      <Accordion className="section-gap">
        <AccordionItem title="More diagnostics" open={diagOpen} onHeadingClick={({ isOpen }: { isOpen: boolean }) => setDiagOpen(isOpen)}>
          {diagOpen && <div className="stack">
            <section>
              <h2 className="chart-title">MAE and mean error by lead time</h2>
              <p className="sub">All published NESO forecast runs, MW; "elapsed" = hours already past at publication.</p>
              <div className="diag-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.byHorizon} margin={{ top: 8, right: 96, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="group" tickFormatter={(g) => (g.startsWith("<0h") ? "elapsed" : g)} stroke={c.axis} tickLine={false} fontSize={12} />
                    <YAxis {...gwAxis(data.byHorizon.flatMap((r) => [r.errorMae, r.errorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                    <Tooltip content={<GroupTooltip c={c} rawOnly />} />
                    <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                      label={endLabel("MAE", c.text.forecast, data.byHorizon.length - 1, -6)} />
                    <Line dataKey="errorBias" stroke={c.forecast} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false}
                      label={endLabel("Mean error", c.text.forecast, data.byHorizon.length - 1, 12)} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section>
              <h2 className="chart-title">MAE by hour of day</h2>
              <p className="sub">NESO and bias-corrected forecasts by delivery hour (UK), MW.</p>
              <div className="diag-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.byHour} margin={{ top: 8, right: 104, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="group" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={5} stroke={c.axis} tickLine={false} fontSize={12} />
                    <YAxis {...gwAxis(data.byHour.flatMap((r) => [r.errorMae, r.adjErrorMae]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                    <Tooltip content={<GroupTooltip c={c} metric="MAE" hour />} />
                    <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                      label={endLabel("NESO", c.text.forecast, data.byHour.length - 1, -6)} />
                    <Line dataKey="adjErrorMae" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false}
                      label={endLabel("Bias-corrected", c.text.adjusted, data.byHour.length - 1, 12)} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section>
              <h2 className="chart-title">Error distribution (forecast − outturn)</h2>
              <p className="sub">Hours per 500 MW bin, NESO forecast; positive = over-forecast.</p>
              <div className="diag-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} barCategoryGap={1} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c.grid} vertical={false} />
                    <XAxis dataKey="mid" tickFormatter={(v) => fmtAxisGW(v)} stroke={c.axis} tickLine={false} fontSize={12} ticks={hist.filter((b) => b.mid % 2000 === 0).map((b) => b.mid)} />
                    <YAxis stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={36} />
                    <ReferenceLine x={0} stroke={c.axis} strokeDasharray="3 3" />
                    <Tooltip cursor={{ fill: c.grid }} content={({ active, payload }) =>
                      active && payload?.length ? (
                        <ChartTooltip title={<>{fmtSignedMW(payload[0].payload.from)} to {fmtSignedMW(payload[0].payload.to)}</>}
                          rows={[{ label: "Hours", value: payload[0].payload.count, color: c.forecast }]} />
                      ) : null} />
                    <Bar dataKey="count" fill={c.forecast} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <Table size="sm" aria-label="Exceedance calibration" className="num-table">
              <TableHead><TableRow><TableHeader>Exceedance level</TableHeader><TableHeader>Target</TableHeader><TableHeader>Hit rate, January 2026</TableHeader><TableHeader>Hit rate, Nov 2025 – Sep 2026</TableHeader></TableRow></TableHead>
              <TableBody>
                {calibration.map((r) => (
                  <TableRow key={r.confidence}>
                    <TableCell>P{r.confidence}</TableCell><TableCell>{fmtPct(r.target)}</TableCell>
                    <TableCell>{fmtPct(r.januaryHitRate)}</TableCell><TableCell>{fmtPct(r.developmentHitRate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>}
        </AccordionItem>
        <AccordionItem title="Methodology">
          <dl className="methodology">
            <dt>Period</dt>
            <dd>Decisions made in January 2026: delivery days {fmtDate(data.period.firstDelivery)} – {fmtDate(data.period.lastDelivery)}, hourly, unless a figure states Nov 2025 – Sep 2026. NESO and bias-corrected forecasts are compared on the same {cmp.adjusted.n} hours.</dd>
            <dt>NESO forecast</dt>
            <dd>For each delivery hour, the latest WINDFOR forecast (Elexon BMRS) published at or before the decision time ({data.cutoff} UK on D-1).</dd>
            <dt>Outturn</dt>
            <dd>FUELHH metered wind generation for the same hour.</dd>
            <dt>Error, mean error</dt>
            <dd>Error = forecast − outturn; positive = over-forecast, the risk of under-buying. Mean error is its average (bias); the NESO forecast over-forecast in {fmtPct(raw.overForecastShare)} of hours.</dd>
            <dt>MAE</dt>
            <dd>Mean absolute error: the average of |error| over the period, in MW. The % change is 1 − bias-corrected ÷ NESO, for MAE and for mean error.</dd>
            <dt>Bias-corrected forecast</dt>
            <dd>NESO forecast × (outturn ÷ forecast) over the previous 7 days, using only outturn known at decision time. Its daily MAE was lower than the NESO forecast's on {cmp.daysAdjustedBetter} of {cmp.days} days.</dd>
            <dt>Hit rate (backtest)</dt>
            <dd>Share of hours with outturn at or above the planning volume at an exceedance level (target = the level). Nov 2025 – Sep 2026 figures use the same method offline (7,775 hours) and are shown for the 09:00/09:20 decision times only.</dd>
            <dt>80% range coverage</dt>
            <dd>Share of hours with outturn inside the 80% range: bias-corrected forecast + the 10th–90th percentile of the previous 7 days' errors ({band.n} hours).</dd>
            <dt>Forecast-level bins</dt>
            <dd>Hours grouped by the NESO forecast at decision time: below 5 GW, 5–10 GW, 10–15 GW, above 15 GW.</dd>
            <dt>Curtailment</dt>
            <dd>Most of the average gap matches wind curtailment (accepted balancing-mechanism bids). This is documented in the project's curtailment analysis, which uses data outside this app.</dd>
            <dt>Caveat</dt>
            <dd>All figures are measured on past data: past performance, not a guarantee.</dd>
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

// Names a bar series once, above its bar in one group (replaces a legend).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const barLabel = (text: string, color: string, at: number, anchor: "start" | "end") => (p: any) =>
  p.index === at
    ? <text x={anchor === "end" ? p.x + p.width : p.x} y={Math.min(p.y, p.y + p.height) - 6} textAnchor={anchor} fill={color} fontSize={12} fontWeight={500}>{text}</text>
    : null;
