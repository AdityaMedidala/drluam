// The app's validated series colours and Carbon chrome greys, per theme (same values as theme.ts).
export const palette = (dark: boolean) => dark
  ? { forecast: "#d95926", adjusted: "#3987e5", plan: "#ff7eb6", band: "#78a9ff", bandOpacity: 0.18, actual: "#f4f4f4",
      grid: "#393939", axis: "#c6c6c6", tooltipBg: "#393939", text: "#f4f4f4" }
  : { forecast: "#eb6834", adjusted: "#2a78d6", plan: "#9f1853", band: "#2a78d6", bandOpacity: 0.14, actual: "#161616",
      grid: "#e0e0e0", axis: "#525252", tooltipBg: "#ffffff", text: "#161616" };
