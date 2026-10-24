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
  return `${Number.isInteger(gw) ? gw.toFixed(0) : gw.toFixed(1)} GW`;
};
