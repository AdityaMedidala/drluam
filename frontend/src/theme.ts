import { useSyncExternalStore } from "react";

// Chart colours by role. Raw forecast = orange, adjusted = blue, actual = ink.
// Validated for colour-vision deficiency in both themes (orange/blue ΔE > 24).
const LIGHT = {
  actual: "#0b0b0b",
  forecast: "#eb6834",
  adjusted: "#2a78d6",
  band: "#2a78d6",
  grid: "#e0e0e0",      // Carbon gray-20 gridlines (g10)
  axis: "#525252",      // Carbon text-secondary (g10)
  surface: "#ffffff",
  bandOpacity: 0.14,
};
const DARK = {
  actual: "#f4f4f4",
  forecast: "#d95926",
  adjusted: "#3987e5",
  band: "#3987e5",
  grid: "#393939",      // Carbon gray-80 gridlines (g100)
  axis: "#c6c6c6",      // Carbon text-secondary (g100)
  surface: "#262626",
  bandOpacity: 0.2,   // tuned for the dark page, not inverted: lower glow, still visible
};
export type ChartColors = typeof LIGHT;
export type Theme = "light" | "dark";

// The theme lives on <html data-theme>; index.html sets it before first paint.
const KEY = "wfd-theme";
const listeners = new Set<() => void>();

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";   // storage blocked (private mode, sandbox): fall back to the default
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // not persisted; the choice still applies for this page view
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export const useTheme = () => useSyncExternalStore(subscribe, snapshot);

export function useChartColors(): ChartColors {
  return useTheme() === "dark" ? DARK : LIGHT;
}
