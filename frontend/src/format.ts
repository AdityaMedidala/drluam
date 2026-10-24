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

/** Y-axis props with whole-GW steps (1/2/5/10 GW) covering the data, always including 0. */
export function gwAxis(values: (number | null | undefined)[]) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  const lo = Math.min(0, ...v);
  const hi = Math.max(0, ...v);
  const step = [1000, 2000, 5000, 10000].find((s) => (hi - lo) / s <= 6) ?? 10000;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step; t += step) ticks.push(t);
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] as [number, number], tickFormatter: fmtAxisGW };
}

/** Whole GWh, for headline sentences. */
export const fmtGWh0 = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${Math.round(mwh / 1000).toLocaleString("en-GB")} GWh`;
