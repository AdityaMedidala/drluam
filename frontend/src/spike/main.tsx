// Chart-library spike: the Decision main chart in Recharts, Carbon Charts and ECharts, side by side.
// Not part of the app; each library loads lazily into its own chunk so bundle sizes can be compared.
import { Theme, Tile, Toggle } from "@carbon/react";
import { lazy, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app.scss";
import { useSpikeData } from "./data";

const RechartsMain = lazy(() => import("./RechartsMain"));
const CarbonChartsMain = lazy(() => import("./CarbonChartsMain"));
const EChartsMain = lazy(() => import("./EChartsMain"));

function Spike() {
  const q = new URLSearchParams(location.search);
  const dark = q.get("theme") === "dark";
  const [showActual, setShowActual] = useState(q.get("actual") === "1");
  const confidence = Number(q.get("confidence") ?? 90);
  const rows = useSpikeData(q.get("date") ?? "2026-01-17", "09:20", confidence);
  const panels: [string, React.ComponentType<{ rows: NonNullable<typeof rows>; confidence: number; showActual: boolean; dark: boolean }>][] = [
    ["Recharts", RechartsMain], ["Carbon Charts", CarbonChartsMain], ["Apache ECharts", EChartsMain],
  ];
  return (
    <Theme theme={dark ? "g100" : "g10"} className="app-theme">
      <main className="page" style={{ maxWidth: 1600 }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 400 }}>Chart library spike · Hourly wind forecast · MW</h1>
          <Toggle id="spike-outturn" size="sm" labelText="Show outturn" labelA="" labelB="" toggled={showActual} onToggle={setShowActual} />
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          {panels.map(([name, C]) => (
            <Tile key={name} className="tile" style={{ height: 420 }}>
              <h2 className="chart-title">{name}</h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Suspense fallback={<p className="sub">Loading {name}…</p>}>
                  {rows && <C rows={rows} confidence={confidence} showActual={showActual} dark={dark} />}
                </Suspense>
              </div>
            </Tile>
          ))}
        </div>
      </main>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Spike /></StrictMode>);
