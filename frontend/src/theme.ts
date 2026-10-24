import { useSyncExternalStore } from "react";

// Chart colours by role. Raw forecast = orange, adjusted = blue, actual = ink.
// Validated for colour-vision deficiency in both themes (orange/blue ΔE > 24).
// Series colours (lines/fills) and their text variants: the text variants meet WCAG AA (≥ 4.5:1)
// on the tile background, which the line colours alone do not (orange #eb6834 is 3.2:1 on white).
// The planning volume is a dashed magenta so it is never confused with outturn (ink).
const LIGHT = {
  actual: "#161616",
  forecast: "#eb6834",
  adjusted: "#2a78d6",
  plan: "#9f1853",
  band: "#2a78d6",
  grid: "#e0e0e0",      // Carbon gray-20 gridlines (g10)
  axis: "#525252",      // Carbon text-secondary (g10)
  surface: "#ffffff",
  bandOpacity: 0.2,    // stronger than before, lighter than Carbon Charts, so lines keep contrast
  text: { actual: "#161616", forecast: "#b8461b", adjusted: "#0f62fe", plan: "#9f1853", muted: "#525252" },
};
const DARK = {
  actual: "#f4f4f4",
  forecast: "#d95926",
  adjusted: "#3987e5",
  plan: "#ff7eb6",
  band: "#78a9ff",      // lighter fill on g100 so the range reads without glowing
  grid: "#393939",      // Carbon gray-80 gridlines (g100)
  axis: "#c6c6c6",      // Carbon text-secondary (g100)
  surface: "#262626",
  bandOpacity: 0.26,
  text: { actual: "#f4f4f4", forecast: "#ff8a5c", adjusted: "#78a9ff", plan: "#ff7eb6", muted: "#c6c6c6" },
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
