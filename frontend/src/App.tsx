import { useEffect, useState } from "react";
import { api, type Meta } from "./api";
import AccuracyView from "./components/AccuracyView";
import DecisionView from "./components/DecisionView";
import { ErrorState, Loading } from "./components/ui";

type Tab = "decision" | "accuracy";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("decision");
  const [cutoff, setCutoff] = useState("09:00");

  useEffect(() => {
    api.meta().then((m) => { setMeta(m); setCutoff(m.defaultCutoff); }).catch((e) => setError(String(e)));
  }, []);

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
        {meta && (
          <label className="cutoff">
            <span className="muted">Decision cutoff (UK, day before)</span>
            <select value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
              {meta.cutoffOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
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

      <footer className="footer muted">
        Data: Elexon BMRS — WINDFOR (forecasts) and FUELHH (actual wind generation). Times in UK local time.
      </footer>
    </div>
  );
}
