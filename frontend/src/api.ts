// Typed client for the FastAPI backend. All calls are relative (/api/...),
// proxied by Vite in dev, nginx in Docker, and same-origin on Vercel.

export interface Meta {
  firstDelivery: string;
  lastDelivery: string;
  defaultCutoff: string;
  cutoffOptions: string[];
  publishSchedule: string[];
}

export interface SeriesPoint {
  time: string;
  actual: number | null;
  forecast: number | null;
  adjusted: number | null;
  low: number | null;
  high: number | null;
}

export interface DayResponse {
  date: string;
  cutoff: string;
  decisionTimeUtc: string | null;
  forecastPublishedUtc: string | null;
  horizonHours: [number, number] | null;
  correctionRatio: number | null;
  historyPoints: number;
  historyPointsFull: number;
  bandCoverage: number | null;   // share of all in-scope hours whose actual fell inside the band
  summary: {
    forecastEnergyMWh: number;
    adjustedEnergyMWh: number | null;
    actualEnergyMWh: number;
    peakForecastMW: number | null;
    minLowMW: number | null;
    maeRaw: number | null;
    maeAdjusted: number | null;
  };
  series: SeriesPoint[];
}

export interface Metrics {
  n: number;
  bias: number;
  mae: number;
  rmse: number;
  nmae: number;
  p10: number;
  p50: number;
  p90: number;
  overForecastShare: number;
}

export interface BandCoverage {
  n: number;
  nominal?: number;
  coverage?: number;
  below?: number;
  above?: number;
  meanWidth?: number;
}

export interface GroupRow {
  group: string;
  n: number;
  errorBias: number | null;
  errorMae: number | null;
  adjErrorBias?: number | null;
  adjErrorMae?: number | null;
}

export interface AccuracyResponse {
  cutoff: string;
  period: { firstDelivery: string; lastDelivery: string };
  raw: Metrics;
  comparison: { days: number; raw: Metrics; adjusted: Metrics };
  band: BandCoverage;
  byHour: GroupRow[];
  byLevel: GroupRow[];
  byHorizon: GroupRow[];
  daily: { deliveryDate: string; actual: number; forecast: number; adjusted: number | null; maeRaw: number; maeAdjusted: number | null }[];
  histogram: { from: number; to: number; mid: number; count: number }[];
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>("/meta"),
  day: (date: string, cutoff: string) => get<DayResponse>("/day", { date, cutoff }),
  accuracy: (cutoff: string) => get<AccuracyResponse>("/accuracy", { cutoff }),
};
