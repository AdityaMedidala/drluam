import { ComboChart } from "@carbon/charts-react";
import "@carbon/charts-react/styles.css";
import { gwAxis } from "../format";
import { palette } from "./colors";
import type { SpikeProps } from "./data";

// Carbon Charts has no dashed-line option; the planning volume is dashed with a CSS override on its path.
export default function CarbonChartsMain({ rows, confidence, showActual, dark }: SpikeProps) {
  const c = palette(dark);
  const plan = `P${confidence} planning volume`;
  const groups = ["NESO forecast", "Bias-corrected forecast", plan, ...(showActual ? ["Outturn"] : [])];
  const n = groups.length + 1;   // colour groups including the band
  const data = rows.flatMap((r) => {
    const date = r.label;   // UK-time labels: the time scale renders in the browser timezone, with no zone option
    return [
      { group: "80% range", date, value: r.adjusted, min: r.low, max: r.high },
      { group: "NESO forecast", date, value: r.forecast },
      { group: "Bias-corrected forecast", date, value: r.adjusted },
      { group: plan, date, value: r.plan },
      ...(showActual ? [{ group: "Outturn", date, value: r.actual }] : []),
    ];
  });
  const y = gwAxis(rows.flatMap((r) => [r.forecast, r.high, r.plan, showActual ? r.actual : null]));
  const options = {
    theme: dark ? "g100" : "g10",
    height: "330px",
    axes: {
      bottom: { mapsTo: "date", scaleType: "labels" },
      left: { mapsTo: "value", title: "MW", domain: y.domain },
    },
    comboChartTypes: [
      { type: "area", options: { bounds: { upperBoundMapsTo: "max", lowerBoundMapsTo: "min" }, points: { enabled: false } }, correspondingDatasets: ["80% range"] },
      { type: "line", options: { points: { enabled: false } }, correspondingDatasets: groups },
    ],
    color: { scale: { "80% range": c.band, "NESO forecast": c.forecast, "Bias-corrected forecast": c.adjusted, [plan]: c.plan, ...(showActual ? { Outturn: c.actual } : {}) } },
    // The bounds must also be set at the top level: other combo layers read options.bounds.
    bounds: { upperBoundMapsTo: "max", lowerBoundMapsTo: "min" },
    legend: { alignment: "left", position: "top" },
    toolbar: { enabled: true },
    accessibility: { svgAriaLabel: `Hourly wind forecast in MW: NESO forecast, bias-corrected forecast, ${plan} and 80% range.` },
  };
  return (
    <div className="spike-cc">
      {/* Lines carry only a positional colour class (stroke-<groups>-1-<index>), not their name, so the
          dash targets the planning volume's index (4th group); the band's own centre line is hidden. */}
      <style>{`.spike-cc path.line.stroke-${n}-1-4 { stroke-dasharray: 6 4; stroke-width: 2px; }
        .spike-cc path.line.stroke-${n}-1-1 { stroke: none; }`}</style>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ComboChart data={data} options={options as any} />
    </div>
  );
}
