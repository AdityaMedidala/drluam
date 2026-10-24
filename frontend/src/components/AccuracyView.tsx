import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AccuracyResponse } from "../api";
import { fmtAxisGW, fmtDate, fmtMW, fmtPct, fmtSignedMW, gwAxis } from "../format";
import { useChartColors, type ChartColors } from "../theme";
import { ChartBlock, ChartTooltip, ErrorState, Loading, endLabel, lastIndex, sourceLine } from "./ui";

/** "How far can we trust the forecast?" across all January decisions. */
export default function AccuracyView({ cutoff }: { cutoff: string }) {
  const c = useChartColors();
  const [data, setData] = useState<AccuracyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.accuracy(cutoff).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [cutoff]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  const { raw, comparison: cmp, band } = data;
  const source = sourceLine(data.cutoff);
  const improvement = 1 - cmp.adjusted.mae / cmp.raw.mae;
  const biasRemoved = 1 - cmp.adjusted.bias / cmp.raw.bias;
  const p90 = data.planCalibration.find((r) => r.confidence === 90);
  const p90Pooled = p90?.developmentHitRate != null;
  const calibration = data.planCalibration;
  const hasDev = calibration.some((r) => r.developmentHitRate != null);
  const daily = data.daily.map((d) => ({ ...d, label: fmtDate(d.deliveryDate), short: fmtDate(d.deliveryDate).split(" ").slice(1).join(" ") }));
  const hist = data.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  const lastLevel = data.byLevel.length - 1;

  return (
    <div className="view">
      <section aria-label="Summary" className="stack" style={{ gap: "var(--s3)" }}>
        <p className="lead">
          In January the day-ahead wind forecast ran about {(raw.bias / 1000).toFixed(1)} GW high — too high in {fmtPct(raw.overForecastShare)} of hours.
        </p>
        <dl className="figures">
          <div><dt>error cut by the adjustment</dt><dd>~{fmtPct(improvement)}</dd></div>
          <div><dt>of the bias removed</dt><dd>~{fmtPct(biasRemoved)}</dd></div>
          <div><dt>plan held at P90 ({p90Pooled ? "Nov 2025–Sep 2026" : "January"})</dt>
            <dd>{fmtPct(p90Pooled ? p90?.developmentHitRate : p90?.januaryHitRate)}</dd></div>
        </dl>
      </section>

      <ChartBlock title="Cautious plans held less often than promised"
        subtitle="Share of hours at or above each plan level, against its target."
        source={hasDev ? `${source} · and Nov 2025–Sep 2026, same method` : source}>
        <div className="h-lg">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={calibration} margin={{ top: 8, right: 120, bottom: 12, left: 0 }}>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis type="number" dataKey="target" domain={[0.4, 1]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => fmtPct(v)}
                stroke={c.axis} tickLine={false} fontSize={12}
                label={{ value: "Plan level (promised share of hours)", position: "insideBottom", offset: -4, fill: c.axis, fontSize: 12 }} height={40} />
              <YAxis type="number" domain={[0.4, 1]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => fmtPct(v)}
                stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={44} />
              <ReferenceLine segment={[{ x: 0.4, y: 0.4 }, { x: 1, y: 1 }]} stroke={c.axis} strokeDasharray="4 4" ifOverflow="hidden" />
              <ReferenceDot x={0.43} y={0.43} r={0} label={{ value: "Promised", position: "right", offset: 8, fill: c.axis, fontSize: 12 }} />
              <Tooltip content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip title={<>P{payload[0].payload.confidence} plan · target {fmtPct(payload[0].payload.target)}</>} rows={[
                    { label: "Held in January", value: fmtPct(payload[0].payload.januaryHitRate), color: c.adjusted },
                    ...(payload[0].payload.developmentHitRate != null
                      ? [{ label: "Held Nov 2025 – Sep 2026", value: fmtPct(payload[0].payload.developmentHitRate), color: c.actual }] : []),
                  ]} />
                ) : null} />
              <Line dataKey="januaryHitRate" stroke={c.adjusted} strokeWidth={1.5} dot={{ r: 4 }} isAnimationActive={false}
                label={endLabel("January 2026", c.adjusted, calibration.length - 1, 14)} />
              {hasDev && <Line dataKey="developmentHitRate" stroke={c.actual} strokeWidth={1.5}
                dot={squareDot(c.actual)} isAnimationActive={false}
                label={endLabel("Nov 2025–Sep 2026", c.actual, calibration.length - 1, -8)} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="table-toggle">
          <summary>View as table</summary>
          <table>
            <thead><tr><th>Plan level</th><th>Target</th><th>Held, January</th><th>Held, Nov 2025 – Sep 2026</th></tr></thead>
            <tbody>
              {calibration.map((r) => (
                <tr key={r.confidence}>
                  <td>P{r.confidence}</td><td>{fmtPct(r.target)}</td><td>{fmtPct(r.januaryHitRate)}</td><td>{fmtPct(r.developmentHitRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </ChartBlock>

      <div className="pair">
        <ChartBlock title={`Adjusted beat raw on ${cmp.daysAdjustedBetter} of ${cmp.days} days`}
          subtitle="Typical hourly error (MAE) for each delivery day." source={source}>
          <div className="h-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="short" stroke={c.axis} tickLine={false} fontSize={12} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...gwAxis(daily.flatMap((d) => [d.maeRaw, d.maeAdjusted]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTooltip title={payload[0].payload.label} rows={[
                      { label: "Raw MAE", value: fmtMW(payload[0].payload.maeRaw), color: c.forecast },
                      { label: "Adjusted MAE", value: fmtMW(payload[0].payload.maeAdjusted), color: c.adjusted },
                    ]} />
                  ) : null} />
                <Line dataKey="maeRaw" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                  label={endLabel("Raw", c.forecast, lastIndex(daily, "maeRaw"), -6)} />
                <Line dataKey="maeAdjusted" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false}
                  label={endLabel("Adjusted", c.adjusted, lastIndex(daily, "maeAdjusted"), 12)} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartBlock>

        <ChartBlock title="The windier the forecast, the bigger the overshoot"
          subtitle="Mean error by forecast level, raw and adjusted." source={source}>
          <div className="h-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byLevel} barGap={2} margin={{ top: 24, right: 56, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis {...gwAxis(data.byLevel.flatMap((r) => [r.errorBias, r.adjErrorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip cursor={{ fill: c.grid }} content={<GroupTooltip c={c} metric="Bias" />} />
                <Bar dataKey="errorBias" fill={c.forecast} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  <LabelList content={barLabel("Raw", c.forecast, lastLevel, "end")} />
                </Bar>
                <Bar dataKey="adjErrorBias" fill={c.adjusted} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  <LabelList content={barLabel("Adjusted", c.adjusted, lastLevel, "start")} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartBlock>
      </div>

      <details className="section">
        <summary>More diagnostics</summary>
        <div className="stack narrow">
          <ChartBlock title="The gap persists at every lead time"
            subtitle="All published forecasts; leftmost point is hours already elapsed." source={source}>
            <div className="h-sm">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.byHorizon} margin={{ top: 8, right: 96, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="group" tickFormatter={(g) => (g.startsWith("<0h") ? "elapsed" : g)} stroke={c.axis} tickLine={false} fontSize={12} />
                  <YAxis {...gwAxis(data.byHorizon.flatMap((r) => [r.errorMae, r.errorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                  <Tooltip content={<GroupTooltip c={c} rawOnly />} />
                  <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                    label={endLabel("Typical error", c.forecast, data.byHorizon.length - 1, -6)} />
                  <Line dataKey="errorBias" stroke={c.forecast} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false}
                    label={endLabel("Bias", c.forecast, data.byHorizon.length - 1, 12)} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartBlock>

          <ChartBlock title="Error varies little by hour of day"
            subtitle="Typical error (MAE) for each delivery hour, UK time." source={source}>
            <div className="h-sm">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.byHour} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="group" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={5} stroke={c.axis} tickLine={false} fontSize={12} />
                  <YAxis {...gwAxis(data.byHour.flatMap((r) => [r.errorMae, r.adjErrorMae]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
                  <Tooltip content={<GroupTooltip c={c} metric="MAE" hour />} />
                  <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false}
                    label={endLabel("Raw", c.forecast, data.byHour.length - 1, -6)} />
                  <Line dataKey="adjErrorMae" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false}
                    label={endLabel("Adjusted", c.adjusted, data.byHour.length - 1, 12)} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartBlock>

          <ChartBlock title="Most hourly errors were overshoots"
            subtitle="Raw forecast minus actual; right of zero means too high." source={source}>
            <div className="h-sm">
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
          </ChartBlock>
        </div>
      </details>

      <details className="section methodology">
        <summary>Methodology</summary>
        <ul>
          <li><strong>Period:</strong> decisions made in January 2026, i.e. delivery days {fmtDate(data.period.firstDelivery)} – {fmtDate(data.period.lastDelivery)}, hourly, unless a figure says Nov 2025 – Sep 2026. Adjusted and raw are compared on the same {cmp.adjusted.n} hours; raw-only figures use all {raw.n}.</li>
          <li><strong>Forecast used:</strong> for each delivery hour, the latest Elexon WINDFOR forecast published at or before the decision cutoff ({data.cutoff} UK the day before). <strong>Actual:</strong> Elexon FUELHH wind generation for the same hour.</li>
          <li><strong>Error</strong> = forecast − actual; positive means the forecast was too high, the risk of buying too little. <strong>Bias:</strong> the average error. <strong>Typical error (MAE):</strong> the average of |error|.</li>
          <li><strong>Adjusted forecast:</strong> raw forecast × (actual ÷ forecast) over the previous 7 days, using only actuals already known at the cutoff. <strong>Error cut:</strong> 1 − adjusted MAE ÷ raw MAE. <strong>Bias removed:</strong> 1 − adjusted bias ÷ raw bias.</li>
          <li><strong>Plan held:</strong> the share of hours the actual came in at or above a plan level (target = the level). The Nov 2025 – Sep 2026 figures come from the same method run offline on those months (7,775 hours) and are shown at the 09:00/09:20 cutoffs only.</li>
          <li><strong>Range (P10–P90):</strong> the adjusted forecast + the 10th–90th percentile of the last 7 days' misses; it held the actual in {fmtPct(band.coverage)} of {band.n} hours, against 80% nominal.</li>
          <li>Most of the average gap matches wind curtailment (accepted bids) — see docs/curtailment-check.md; that analysis uses data outside this app.</li>
          <li>All figures are measured on past data. They describe how the method did, not a guarantee of how it will do.</li>
        </ul>
      </details>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GroupTooltip({ active, payload, metric, rawOnly, hour, c }: any & { c: ChartColors }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const title = hour ? `${String(p.group).padStart(2, "0")}:00 UK` : p.group;
  const rows = rawOnly
    ? [{ label: "Typical error", value: fmtMW(p.errorMae), color: c.forecast }, { label: "Bias", value: fmtSignedMW(p.errorBias), color: c.forecast }]
    : metric === "Bias"
      ? [{ label: "Raw bias", value: fmtSignedMW(p.errorBias), color: c.forecast }, { label: "Adjusted bias", value: fmtSignedMW(p.adjErrorBias), color: c.adjusted }]
      : [{ label: "Raw MAE", value: fmtMW(p.errorMae), color: c.forecast }, { label: "Adjusted MAE", value: fmtMW(p.adjErrorMae), color: c.adjusted }];
  return <ChartTooltip title={title} rows={[...rows, { label: "Hours", value: p.n }]} />;
}

// Square markers keep the second calibration series distinct without relying on colour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const squareDot = (fill: string) => ({ cx, cy, index }: any) =>
  cx == null || cy == null ? <g key={index} /> : <rect key={index} x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} />;

// Names a bar series once, above its bar in one group (replaces a legend).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const barLabel = (text: string, color: string, at: number, anchor: "start" | "end") => (p: any) =>
  p.index === at
    ? <text x={anchor === "end" ? p.x + p.width : p.x} y={Math.min(p.y, p.y + p.height) - 6} textAnchor={anchor} fill={color} fontSize={12} fontWeight={500}>{text}</text>
    : null;
