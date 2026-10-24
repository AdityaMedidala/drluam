import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { gwAxis } from "../format";
import { palette } from "./colors";
import type { SpikeProps } from "./data";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

const mw = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`);

export default function EChartsMain({ rows, confidence, showActual, dark }: SpikeProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = palette(dark);
    const plan = `P${confidence} planning volume`;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    const y = gwAxis(rows.flatMap((r) => [r.forecast, r.high, r.plan, showActual ? r.actual : null]));
    const line = (name: string, key: keyof typeof rows[number], color: string, dashed = false) => ({
      name, type: "line" as const, data: rows.map((r) => r[key]), showSymbol: false, color,
      lineStyle: { width: dashed ? 2 : 1.5, type: dashed ? ("dashed" as const) : ("solid" as const), color },
    });
    chart.setOption({
      // The band is two stacked series: an invisible lower edge, then the range width filled.
      aria: { enabled: true, label: { description: `Hourly wind forecast in MW for one delivery day: NESO forecast, bias-corrected forecast, ${plan} and 80% range.` } },
      textStyle: { fontFamily: "IBM Plex Sans, sans-serif", color: c.axis },
      legend: { top: 0, left: 0, itemWidth: 20, itemHeight: 8, textStyle: { color: c.axis, fontSize: 12 },
        data: ["NESO forecast", "Bias-corrected forecast", plan, "80% range", ...(showActual ? ["Outturn"] : [])] },
      grid: { left: 56, right: 16, top: 36, bottom: 28 },
      tooltip: {
        trigger: "axis", backgroundColor: c.tooltipBg, borderWidth: 0, padding: [8, 12],
        textStyle: { color: c.text, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
        extraCssText: "box-shadow: 0 2px 6px rgba(0,0,0,0.3); border-radius: 0;",
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0].dataIndex];
          const row = (l: string, v: string, col: string) => `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="display:inline-block;width:8px;height:8px;margin-right:4px;background:${col}"></span>${l}</span><b>${v}</b></div>`;
          return `<div style="font-weight:600;margin-bottom:4px">${r.label} UK</div>`
            + row("NESO forecast", mw(r.forecast), c.forecast) + row("Bias-corrected forecast", mw(r.adjusted), c.adjusted)
            + row(plan, mw(r.plan), c.plan) + row("80% range", `${mw(r.low)} – ${mw(r.high)}`, c.band)
            + (showActual ? row("Outturn", mw(r.actual), c.actual) : "");
        },
      },
      xAxis: { type: "category", data: rows.map((r) => r.label), boundaryGap: false, axisTick: { show: false },
        axisLine: { lineStyle: { color: c.axis } }, axisLabel: { color: c.axis, fontSize: 12, interval: 5 } },
      yAxis: { type: "value", min: y.domain[0], max: y.domain[1], interval: y.ticks[1] - y.ticks[0],
        axisLabel: { color: c.axis, fontSize: 12, formatter: (v: number) => `${v / 1000} GW` }, splitLine: { lineStyle: { color: c.grid } } },
      series: [
        { name: "80% range-low", type: "line", data: rows.map((r) => r.low), stack: "band", showSymbol: false, lineStyle: { opacity: 0 }, tooltip: { show: false } },
        { name: "80% range", type: "line", data: rows.map((r) => (r.high != null && r.low != null ? r.high - r.low : null)), stack: "band",
          showSymbol: false, lineStyle: { opacity: 0 }, color: c.band, areaStyle: { color: c.band, opacity: c.bandOpacity } },
        line("NESO forecast", "forecast", c.forecast),
        line("Bias-corrected forecast", "adjusted", c.adjusted),
        line(plan, "plan", c.plan, true),
        ...(showActual ? [line("Outturn", "actual", c.actual)] : []),
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.dispose(); };
  }, [rows, confidence, showActual, dark]);
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
