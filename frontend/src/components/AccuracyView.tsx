import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AccuracyResponse } from "../api";
import { fmtAxisGW, fmtDate, fmtMW, fmtPct, fmtSignedMW, gwAxis } from "../format";
import { useChartColors, type ChartColors } from "../theme";
import { ChartCard, ErrorState, Insight, LegendItem, Loading, StatTile } from "./ui";

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
  const improvement = 1 - cmp.adjusted.mae / cmp.raw.mae;
  const biasRemoved = 1 - cmp.adjusted.bias / cmp.raw.bias;
  // The "<0h (already elapsed)" bucket holds forecasts published after their hour began.
  const elapsed = data.byHorizon.find((r) => r.group.startsWith("<0h"));
  const ahead = data.byHorizon.filter((r) => r !== elapsed);
  const near = ahead[0];
  const far = ahead[ahead.length - 1];
  const windiest = data.byLevel[data.byLevel.length - 1];
  const hist = data.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  const daily = data.daily.map((d) => ({ ...d, label: fmtDate(d.deliveryDate), short: fmtDate(d.deliveryDate).split(" ").slice(1).join(" ") }));
  const calibration = data.planCalibration;
  const hasDev = calibration.some((r) => r.developmentHitRate != null);

  return (
    <div className="view">
      <Insight>
        In January the forecast available at decision time was <strong>too high in {fmtPct(raw.overForecastShare)} of hours</strong>,
        by <strong>{fmtMW(raw.bias)}</strong> on average. A desk buying against the raw forecast would have
        tended to under-buy. Rescaling by the previous week's track record <strong>removed ~{fmtPct(biasRemoved)} of the bias</strong> and
        cut the typical error by <strong>~{fmtPct(improvement)}</strong> in January; it beat the raw forecast on {cmp.daysAdjustedBetter} of {cmp.days} days.
        Its uncertainty band held the actual in {fmtPct(band.coverage)} of hours, short of the 80% it aims for.
      </Insight>

      <div className="tiles">
        <StatTile tone="accent" label="Typical error (MAE)"
          value={<>{fmtMW(cmp.adjusted.mae)}</>}
          sub={<>Adjusted forecast · raw: {fmtMW(cmp.raw.mae)}</>} />
        <StatTile label="Bias removed"
          value={fmtPct(biasRemoved)}
          sub={<>Average bias: raw {fmtSignedMW(cmp.raw.bias)} → adjusted {fmtSignedMW(cmp.adjusted.bias)} (+ = forecast too high)</>} />
        <StatTile label="Error as share of output"
          value={fmtPct(cmp.adjusted.nmae, 1)}
          sub={<>Adjusted · raw: {fmtPct(cmp.raw.nmae, 1)}</>} />
        <StatTile label="Band coverage"
          value={fmtPct(band.coverage)}
          sub={<>Hours the actual fell inside the P10–P90 band (aim 80%) · {fmtPct(band.below)} below, {fmtPct(band.above)} above · avg width {fmtMW(band.meanWidth)}</>} />
      </div>
      <p className="footnote">
        Adjusted vs raw compared on the same {cmp.adjusted.n} hours ({cmp.days} delivery days); raw-only figures cover all {raw.n} hours,
        {" "}{fmtDate(data.period.firstDelivery)} – {fmtDate(data.period.lastDelivery)}. Decision cutoff {data.cutoff} UK on the day before delivery.
      </p>

      <div className="grid">
        <ChartCard title="Does the plan hold as often as it promises?"
          subtitle={<>Each &quot;plan on&quot; level from the Decision view: the share of hours the actual came in at or above it, against its target · on the dashed line = honest; below it = the plan promises more than it delivers</>}
          legend={<>
            <LegendItem color={c.adjusted} label="January 2026 (circles)" />
            {hasDev && <LegendItem color={c.actual} label="Nov 2025 – Sep 2026 (squares)" />}
            <LegendItem color={c.axis} label="Target (45°)" dashed />
          </>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calibration} margin={{ top: 8, right: 16, bottom: 12, left: 0 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis type="number" dataKey="target" domain={[0.4, 1]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => fmtPct(v)}
                  stroke={c.axis} tickLine={false} fontSize={12}
                  label={{ value: "Target (plan level)", position: "insideBottom", offset: -2, fill: c.axis, fontSize: 11 }} height={36} />
                <YAxis type="number" domain={[0.4, 1]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} tickFormatter={(v) => fmtPct(v)}
                  stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={44} />
                <ReferenceLine segment={[{ x: 0.4, y: 0.4 }, { x: 1, y: 1 }]} stroke={c.axis} strokeDasharray="4 4" ifOverflow="hidden" />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="tooltip">
                      <div className="tooltip-title">P{payload[0].payload.confidence} plan · target {fmtPct(payload[0].payload.target)}</div>
                      <div className="tooltip-row"><span>Held in January</span><strong>{fmtPct(payload[0].payload.januaryHitRate)}</strong></div>
                      {payload[0].payload.developmentHitRate != null && (
                        <div className="tooltip-row"><span>Held Nov 2025 – Sep 2026</span><strong>{fmtPct(payload[0].payload.developmentHitRate)}</strong></div>
                      )}
                    </div>
                  ) : null} />
                <Line dataKey="januaryHitRate" stroke={c.adjusted} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                {hasDev && <Line dataKey="developmentHitRate" stroke={c.actual} strokeWidth={2}
                  dot={squareDot(c.actual)} isAnimationActive={false} />}
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
        </ChartCard>

        <ChartCard title="Day by day"
          subtitle="Typical hourly error (MAE) for each delivery day — the adjustment tended to help most on days the raw forecast overshot"
          legend={<><LegendItem color={c.forecast} label="Raw" /><LegendItem color={c.adjusted} label="Adjusted" /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="short" stroke={c.axis} tickLine={false} fontSize={12} interval="preserveStartEnd" minTickGap={16} />
                <YAxis {...gwAxis(daily.flatMap((d) => [d.maeRaw, d.maeAdjusted]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} />
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="tooltip">
                      <div className="tooltip-title">{payload[0].payload.label}</div>
                      <div className="tooltip-row"><span>Raw MAE</span><strong>{fmtMW(payload[0].payload.maeRaw)}</strong></div>
                      <div className="tooltip-row"><span>Adjusted MAE</span><strong>{fmtMW(payload[0].payload.maeAdjusted)}</strong></div>
                      <div className="tooltip-row"><span>Avg actual</span><strong>{fmtMW(payload[0].payload.actual)}</strong></div>
                    </div>
                  ) : null} />
                <Line dataKey="maeRaw" stroke={c.forecast} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line dataKey="maeAdjusted" stroke={c.adjusted} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Bias by wind level"
          subtitle={<>The windier the forecast, the more it overshoots: {fmtSignedMW(windiest.errorBias)} when it predicts {windiest.group}</>}
          legend={<><LegendItem color={c.forecast} label="Raw" /><LegendItem color={c.adjusted} label="Adjusted" /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byLevel} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis {...gwAxis(data.byLevel.flatMap((r) => [r.errorBias, r.adjErrorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip cursor={{ fill: c.grid }} content={<GroupTooltip c={c} metric="Bias" />} />
                <Bar dataKey="errorBias" fill={c.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="adjErrorBias" fill={c.adjusted} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Error by lead time"
          subtitle={<>All published forecasts · typical error grows from {fmtMW(near.errorMae)} at {near.group} to {fmtMW(far.errorMae)} at {far.group} — but even the freshest forecasts run {fmtSignedMW(near.errorBias)} high{elapsed && <>, and so do forecasts for hours that had <strong>already elapsed</strong> when published ({fmtSignedMW(elapsed.errorBias)}, leftmost point)</>}</>}
          legend={<><LegendItem color={c.forecast} label="Typical error (MAE)" /><LegendItem color={c.forecast} label="Bias" dashed /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.byHorizon} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" tickFormatter={(g) => (g.startsWith("<0h") ? "elapsed" : g)} stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis {...gwAxis(data.byHorizon.flatMap((r) => [r.errorMae, r.errorBias]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} />
                <Tooltip content={<GroupTooltip c={c} rawOnly />} />
                <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="errorBias" stroke={c.forecast} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="How far off was each hour?"
          subtitle="Raw forecast minus actual, all hours · right of zero = forecast too high"
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} barCategoryGap={2} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="mid" tickFormatter={(v) => fmtAxisGW(v)} stroke={c.axis} tickLine={false} fontSize={12} ticks={hist.filter((b) => b.mid % 2000 === 0).map((b) => b.mid)} />
                <YAxis stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={36} />
                <ReferenceLine x={0} stroke={c.axis} strokeDasharray="3 3" />
                <Tooltip cursor={{ fill: c.grid }} content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="tooltip">
                      <div className="tooltip-title">{fmtSignedMW(payload[0].payload.from)} to {fmtSignedMW(payload[0].payload.to)}</div>
                      <div className="tooltip-row"><span>Hours</span><strong>{payload[0].payload.count}</strong></div>
                    </div>
                  ) : null} />
                <Bar dataKey="count" fill={c.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Error by hour of day"
          subtitle="Typical error (MAE) for each delivery hour, UK time"
          legend={<><LegendItem color={c.forecast} label="Raw" /><LegendItem color={c.adjusted} label="Adjusted" /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.byHour} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={3} stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis {...gwAxis(data.byHour.flatMap((r) => [r.errorMae, r.adjErrorMae]))} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} />
                <Tooltip content={<GroupTooltip c={c} metric="MAE" hour />} />
                <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="adjErrorMae" stroke={c.adjusted} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <section className="card method">
        <h3>How these numbers are calculated</h3>
        <ul>
          <li><strong>Forecast used:</strong> for each delivery hour, the latest Elexon WINDFOR forecast published at or before the decision cutoff ({data.cutoff} UK the day before). Later forecasts are ignored — the desk couldn't have seen them in time.</li>
          <li><strong>Actual:</strong> Elexon FUELHH wind generation for the same hour.</li>
          <li><strong>Adjusted forecast:</strong> raw forecast × (actual ÷ forecast) over the previous 7 days, using only actuals already known at the cutoff.</li>
          <li><strong>Band:</strong> adjusted forecast + the 10th–90th percentile of what the adjusted forecast actually missed by (actual − adjusted) over the previous 7 days (each of those days adjusted with its own prior week). Measured coverage: {fmtPct(band.coverage)} of {band.n} hours.</li>
          <li><strong>Error</strong> = forecast − actual. Positive means the forecast was too high, i.e. the risk of buying too little.</li>
          <li><strong>Period:</strong> every figure on this page covers decisions made in January 2026, i.e. delivery days {fmtDate(data.period.firstDelivery)} – {fmtDate(data.period.lastDelivery)}, hourly, unless it says Nov 2025 – Sep 2026.</li>
          <li><strong>Typical error (MAE):</strong> the average of |error| over those hours. <strong>Error as share of output (nMAE):</strong> MAE ÷ average actual generation. <strong>Bias:</strong> the average error, with its sign.</li>
          <li><strong>Bias removed:</strong> 1 − adjusted bias ÷ raw bias, on the same hours.</li>
          <li><strong>Plan hit rate:</strong> the share of hours the actual came in at or above a "plan on" level (target = the level). The Nov 2025 – Sep 2026 figures come from the same method run offline on those months (7,775 hours) and are shown at the 09:00/09:20 cutoffs only.</li>
          <li>All figures are measured on past data. They describe how the method did, not a guarantee of how it will do.</li>
        </ul>
      </section>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GroupTooltip({ active, payload, metric, rawOnly, hour }: any & { c: ChartColors }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const title = hour ? `${String(p.group).padStart(2, "0")}:00 UK` : p.group;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title}</div>
      {rawOnly ? (
        <>
          <div className="tooltip-row"><span>Typical error</span><strong>{fmtMW(p.errorMae)}</strong></div>
          <div className="tooltip-row"><span>Bias</span><strong>{fmtSignedMW(p.errorBias)}</strong></div>
        </>
      ) : metric === "Bias" ? (
        <>
          <div className="tooltip-row"><span>Raw bias</span><strong>{fmtSignedMW(p.errorBias)}</strong></div>
          <div className="tooltip-row"><span>Adjusted bias</span><strong>{fmtSignedMW(p.adjErrorBias)}</strong></div>
        </>
      ) : (
        <>
          <div className="tooltip-row"><span>Raw MAE</span><strong>{fmtMW(p.errorMae)}</strong></div>
          <div className="tooltip-row"><span>Adjusted MAE</span><strong>{fmtMW(p.adjErrorMae)}</strong></div>
        </>
      )}
      <div className="tooltip-row muted"><span>Hours</span><span>{p.n}</span></div>
    </div>
  );
}

// Square markers keep the second calibration series distinct without relying on colour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const squareDot = (fill: string) => ({ cx, cy, index }: any) =>
  cx == null || cy == null ? <g key={index} /> : <rect key={index} x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} />;
