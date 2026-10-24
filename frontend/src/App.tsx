import { useEffect, useState } from "react";
import { api, type Meta, type Provenance } from "./api";
import AccuracyView from "./components/AccuracyView";
import DecisionView from "./components/DecisionView";
import { ErrorState, Loading } from "./components/ui";
import { setTheme, useTheme } from "./theme";
import { readParam, writeParam } from "./url";

// GB day-ahead auction gate closures (UK time).
const GATES: Record<string, string> = { "09:20": "EPEX gate", "09:50": "N2EX gate" };

type Tab = "decision" | "accuracy";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("decision");
  const [cutoff, setCutoff] = useState("09:20");
  const [prov, setProv] = useState<Provenance | null>(null);
  const theme = useTheme();

  useEffect(() => {
    api.meta().then((m) => {
      const fromUrl = readParam("cutoff");
      setCutoff(fromUrl && m.cutoffOptions.includes(fromUrl) ? fromUrl : m.defaultCutoff);
      setMeta(m);
    }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { if (meta) writeParam("cutoff", cutoff); }, [meta, cutoff]);
  useEffect(() => { api.provenance().then(setProv).catch(() => setProv(null)); }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 12 L12 3 M12 12 L4.5 16.5 M12 12 L19.5 16.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
          </span>
          <div>
            <h1>Wind Forecast Desk</h1>
            <p className="muted">GB national wind · day-ahead purchase decisions · January 2026 pilot</p>
          </div>
        </div>
        <div className="topbar-controls">
        {meta && (
          <label className="field">
            Decision cutoff (UK, day before)
            <select value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
              {meta.cutoffOptions.map((o) => <option key={o} value={o}>{o}{GATES[o] ? ` (${GATES[o]})` : ""}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "decision"} onClick={() => setTab("decision")}>Forecast at decision time</button>
        <button role="tab" aria-selected={tab === "accuracy"} onClick={() => setTab("accuracy")}>Forecast accuracy</button>
      </nav>

      <main>
        {error && <ErrorState error={error} />}
        {!meta && !error && <Loading />}
        {meta && (tab === "decision" ? <DecisionView meta={meta} cutoff={cutoff} /> : <AccuracyView cutoff={cutoff} />)}
      </main>

      <footer className="provenance" aria-label="Data provenance">
        <span>Source: Elexon BMRS (WINDFOR, FUELHH)</span>
        {prov && <span> · snapshot fetched {new Date(prov.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
        {prov && (prov.allVerified
          ? <span> · checksums match</span>
          : <span className="bad"> · checksum mismatch: {prov.files.filter((f) => !f.verified).map((f) => f.file).join(", ")}</span>)}
        <span> · times in UK local time</span>
      </footer>
    </div>
  );
}
