import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type AccuracyResponse } from "../api";
import { fmtAxisGW, fmtDate, fmtMW, fmtPct, fmtSignedMW } from "../format";
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
  const near = data.byHorizon[0];
  const far = data.byHorizon[data.byHorizon.length - 1];
  const windiest = data.byLevel[data.byLevel.length - 1];
  const hist = data.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  const daily = data.daily.map((d) => ({ ...d, label: fmtDate(d.deliveryDate) }));

  return (
    <div className="view">
      <Insight>
        In January the forecast available at decision time was <strong>too high in {fmtPct(raw.overForecastShare)} of hours</strong>,
        by <strong>{fmtMW(raw.bias)}</strong> on average. A desk buying against the raw forecast would have
        systematically under-bought. Rescaling by the previous week's track record cuts the typical error
        by <strong>{fmtPct(improvement)}</strong>.
      </Insight>

      <div className="tiles">
        <StatTile tone="accent" label="Typical error (MAE)"
          value={<>{fmtMW(cmp.adjusted.mae)}</>}
          sub={<>Adjusted forecast · raw: {fmtMW(cmp.raw.mae)}</>} />
        <StatTile label="Average bias"
          value={fmtSignedMW(cmp.adjusted.bias)}
          sub={<>Adjusted · raw: {fmtSignedMW(cmp.raw.bias)} (+ = forecast too high)</>} />
        <StatTile label="Error as share of output"
          value={fmtPct(cmp.adjusted.nmae, 1)}
          sub={<>Adjusted · raw: {fmtPct(cmp.raw.nmae, 1)}</>} />
        <StatTile label="Band coverage"
          value={fmtPct(band.coverage)}
          sub={<>Hours the actual fell inside the P10–P90 band (aim 80%) · {fmtPct(band.below)} below, {fmtPct(band.above)} above · avg width {fmtMW(band.meanWidth)}</>} />
        <StatTile label="Raw error range (P10 – P90)"
          value={<>{fmtSignedMW(raw.p10)} to {fmtSignedMW(raw.p90)}</>}
          sub="80% of hourly raw-forecast errors fall in this range" />
      </div>
      <p className="footnote">
        Adjusted vs raw compared over the {cmp.days} delivery days with a week of history; raw-only figures cover all {raw.n} hours,
        {" "}{fmtDate(data.period.firstDelivery)} – {fmtDate(data.period.lastDelivery)}. Decision cutoff {data.cutoff} UK on the day before delivery.
      </p>

      <div className="grid">
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

        <ChartCard title="Error by lead time"
          subtitle={<>All published forecasts · typical error grows from {fmtMW(near.errorMae)} at {near.group} to {fmtMW(far.errorMae)} at {far.group} — but even the freshest forecasts run {fmtSignedMW(near.errorBias)} high</>}
          legend={<><LegendItem color={c.forecast} label="Typical error (MAE)" /><LegendItem color={c.forecast} label="Bias" dashed /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.byHorizon} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="group" stroke={c.axis} tickLine={false} fontSize={12} />
                <YAxis tickFormatter={fmtAxisGW} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} domain={[0, "auto"]} />
                <Tooltip content={<GroupTooltip c={c} rawOnly />} />
                <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="errorBias" stroke={c.forecast} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} isAnimationActive={false} />
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
                <YAxis tickFormatter={fmtAxisGW} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip cursor={{ fill: c.grid }} content={<GroupTooltip c={c} metric="Bias" />} />
                <Bar dataKey="errorBias" fill={c.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="adjErrorBias" fill={c.adjusted} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
                <YAxis tickFormatter={fmtAxisGW} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} domain={[0, "auto"]} />
                <Tooltip content={<GroupTooltip c={c} metric="MAE" hour />} />
                <Line dataKey="errorMae" stroke={c.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="adjErrorMae" stroke={c.adjusted} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard wide title="Day by day"
          subtitle="Typical hourly error for each delivery day — the adjustment helps most on days the raw forecast overshoots"
          legend={<><LegendItem color={c.forecast} label="Raw" /><LegendItem color={c.adjusted} label="Adjusted" /></>}
        >
          <div className="chart-md">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="label" stroke={c.axis} tickLine={false} fontSize={12} interval={3} />
                <YAxis tickFormatter={fmtAxisGW} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={60} domain={[0, "auto"]} />
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
      </div>

      <section className="card method">
        <h3>How these numbers are calculated</h3>
        <ul>
          <li><strong>Forecast used:</strong> for each delivery hour, the latest Elexon WINDFOR forecast published before the decision cutoff ({data.cutoff} UK the day before). Later forecasts are ignored — the desk couldn't have seen them in time.</li>
          <li><strong>Actual:</strong> Elexon FUELHH wind generation for the same hour.</li>
          <li><strong>Adjusted forecast:</strong> raw forecast × (actual ÷ forecast) over the previous 7 days, using only actuals already known at the cutoff.</li>
          <li><strong>Band:</strong> adjusted forecast + the 10th–90th percentile of the errors the adjusted forecast actually made over the previous 7 days (each of those days adjusted with its own prior week). Measured coverage: {fmtPct(band.coverage)} of {band.n} hours.</li>
          <li><strong>Error</strong> = forecast − actual. Positive means the forecast was too high, i.e. the risk of buying too little.</li>
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
