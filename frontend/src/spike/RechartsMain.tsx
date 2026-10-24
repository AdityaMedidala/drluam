import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gwAxis } from "../format";
import { ChartLegend, ChartTooltip } from "../components/ui";
import { palette } from "./colors";
import type { SpikeProps } from "./data";

const mw = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`);

export default function RechartsMain({ rows, confidence, showActual, dark }: SpikeProps) {
  const c = palette(dark);
  const data = rows.map((r) => ({ ...r, band: r.low != null && r.high != null ? [r.low, r.high] : null }));
  const y = gwAxis(rows.flatMap((r) => [r.forecast, r.high, r.plan, showActual ? r.actual : null]));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <ChartLegend items={[
        { label: "NESO forecast", color: c.forecast }, { label: "Bias-corrected forecast", color: c.adjusted },
        { label: `P${confidence} planning volume`, color: c.plan, kind: "dash" }, { label: "80% range", color: c.band, kind: "band" },
        ...(showActual ? [{ label: "Outturn", color: c.actual }] : []),
      ]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* accessibilityLayer: focusable chart, arrow keys move the tooltip hour by hour */}
          <ComposedChart data={data} accessibilityLayer margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" interval={5} stroke={c.axis} tickLine={false} fontSize={12} />
            <YAxis {...y} stroke={c.axis} tickLine={false} axisLine={false} fontSize={12} width={52} />
            <Tooltip content={({ active, payload }) => active && payload?.length ? (
              <ChartTooltip title={`${payload[0].payload.label} UK`} rows={[
                { label: "NESO forecast", value: mw(payload[0].payload.forecast), color: c.forecast },
                { label: "Bias-corrected forecast", value: mw(payload[0].payload.adjusted), color: c.adjusted },
                { label: `P${confidence} planning volume`, value: mw(payload[0].payload.plan), color: c.plan },
                { label: "80% range", value: `${mw(payload[0].payload.low)} – ${mw(payload[0].payload.high)}`, color: c.band },
                ...(showActual ? [{ label: "Outturn", value: mw(payload[0].payload.actual), color: c.actual }] : []),
              ]} />) : null} />
            <Area dataKey="band" name="80% range" stroke="none" fill={c.band} fillOpacity={c.bandOpacity} isAnimationActive={false} />
            <Line dataKey="forecast" name="NESO forecast" stroke={c.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="adjusted" name="Bias-corrected forecast" stroke={c.adjusted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="plan" name={`P${confidence} planning volume`} stroke={c.plan} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            {showActual && <Line dataKey="actual" name="Outturn" stroke={c.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
