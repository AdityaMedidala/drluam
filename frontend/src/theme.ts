import { useEffect, useState } from "react";

// Chart colours by role. Raw forecast = orange, adjusted = blue, actual = ink.
// Validated for colour-vision deficiency in both themes (orange/blue ΔE > 24).
const LIGHT = {
  actual: "#0b0b0b",
  forecast: "#eb6834",
  adjusted: "#2a78d6",
  band: "#2a78d6",
  grid: "#e4e3df",
  axis: "#6b6a66",
  surface: "#ffffff",
};
const DARK = {
  actual: "#f0efec",
  forecast: "#d95926",
  adjusted: "#3987e5",
  band: "#3987e5",
  grid: "#33332f",
  axis: "#a3a29b",
  surface: "#1a1a19",
};
export type ChartColors = typeof LIGHT;

export function useChartColors(): ChartColors {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark ? DARK : LIGHT;
}
