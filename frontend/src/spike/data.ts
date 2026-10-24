// Shared input for the three spike charts: one delivery day, hourly rows.
import { useEffect, useState } from "react";
import { api } from "../api";

export interface Row { time: string; label: string; forecast: number | null; adjusted: number | null; plan: number | null; low: number | null; high: number | null; actual: number | null }

export function useSpikeData(date: string, cutoff: string, confidence: number) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    Promise.all([api.day(date, cutoff), api.plan(date, cutoff, confidence)]).then(([d, p]) => {
      const plan = new Map(p.hours.map((h) => [h.time, h.planMW]));
      setRows(d.series.filter((s) => s.forecast != null).map((s) => ({
        time: s.time,
        label: new Date(s.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }),
        forecast: s.forecast, adjusted: s.adjusted, plan: plan.get(s.time) ?? null, low: s.low, high: s.high, actual: s.actual,
      })));
    });
  }, [date, cutoff, confidence]);
  return rows;
}

export interface SpikeProps { rows: Row[]; confidence: number; showActual: boolean; dark: boolean }
