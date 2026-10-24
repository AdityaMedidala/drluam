// Formatting helpers. Times are always shown in UK local time, which is what
// the client's trading desk works in (equal to UTC in January).
const UK = "Europe/London";

export const fmtMW = (v: number | null | undefined) =>
  v == null ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`;

export const fmtSignedMW = (v: number | null | undefined) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-GB")} MW`;

export const fmtGWh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${(mwh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} GWh`;

export const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${(v * 100).toFixed(digits)}%`;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: UK });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: UK,
  });

export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export const shiftDate = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const fmtAxisGW = (v: number) => {
  const gw = v / 1000;
  return `${(Number.isInteger(gw) ? gw.toFixed(0) : gw.toFixed(1)).replace("-", "−")} GW`;
};

/** Plain GW tick numbers (the unit sits once on the axis title): 4000 -> "4", 2500 -> "2.5". */
export const fmtGWNumber = (mw: number) => {
  const gw = mw / 1000;
  return (Number.isInteger(gw) ? gw.toFixed(0) : gw.toFixed(1)).replace("-", "−");
};

/** Y-axis props: starts at 0 (or the round step below a negative minimum) and ends at the smallest
 *  round value just above the data, with at most six whole-GW steps. */
export function gwAxis(values: (number | null | undefined)[]) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  const lo = Math.min(0, ...v);
  const hi = Math.max(0, ...v);
  // Smallest round top wins; on a tie prefer a "nice" step (1/2/5/10 GW), then the finer one.
  const nice = (step: number) => [1000, 2000, 5000, 10000].includes(step);
  let best: { ticks: number[]; top: number; step: number } | null = null;
  for (const step of [1000, 2000, 3000, 4000, 5000, 10000]) {
    const bottom = Math.floor(lo / step) * step;
    const top = Math.max(step, Math.ceil(hi / step) * step);
    if ((top - bottom) / step > 6) continue;
    const better = !best || top - bottom < best.top || (top - bottom === best.top
      && (nice(step) && !nice(best.step) || (nice(step) === nice(best.step) && step < best.step)));
    if (better) {
      const ticks: number[] = [];
      for (let t = bottom; t <= top; t += step) ticks.push(t);
      best = { ticks, top: top - bottom, step };
    }
  }
  const ticks = best!.ticks;
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], tickFormatter: fmtGWNumber };
}
/** Whole GWh, for headline sentences. */
export const fmtGWh0 = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${Math.round(mwh / 1000).toLocaleString("en-GB")} GWh`;
