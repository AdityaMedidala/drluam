import type { PlanResponse } from "../api";
import { fmtDate, fmtGWh, fmtPct } from "../format";
import { ErrorState, Loading } from "./ui";

export const CONFIDENCES = [50, 70, 80, 90, 95];

/** "How much wind can the desk count on?" at a chosen confidence, with the hit rate it really achieved. */
export default function PlanPanel({ plan, error, confidence, onConfidence }: {
  plan: PlanResponse | null; error: string | null; confidence: number; onConfidence: (c: number) => void;
}) {
  const level = plan?.calibration.find((r) => r.confidence === confidence);
  const extra = plan?.day.extraToProcureMWh;

  return (
    <section className="card plan">
      <header className="card-head">
        <div>
          <h3>Plan on{plan ? ` · ${fmtDate(plan.date)}` : ""}</h3>
          <p className="muted">Wind the desk can count on at a chosen confidence, from the adjusted forecast and the last 7 days' errors. Each option shows how often it actually held: over Nov 2025 – Sep 2026 ("held"), and in January.</p>
        </div>
      </header>

      <div className="plan-levels" role="radiogroup" aria-label="Planning confidence">
        {CONFIDENCES.map((c) => {
          const r = plan?.calibration.find((x) => x.confidence === c);
          const held = r?.developmentHitRate ?? r?.januaryHitRate;
          return (
            <button key={c} role="radio" aria-checked={c === confidence} onClick={() => onConfidence(c)}
              aria-label={`P${c}: target ${c}% of hours, held ${fmtPct(held)} of hours`}>
              <strong>P{c}</strong>
              <span>held {fmtPct(held)} of hours</span>
              <span className="muted">target {c}% · Jan {fmtPct(r?.januaryHitRate)}</span>
            </button>
          );
        })}
      </div>

      {error && <ErrorState error={error} />}
      {!plan && !error && <Loading />}
      {plan && level && (
        plan.day.planMWh == null ? (
          <p className="muted">Not enough history before this day to build a plan.</p>
        ) : (
          <div className="plan-body">
            <div className="tiles">
              <div className="tile tile-accent">
                <div className="tile-label">Wind to plan on (P{confidence})</div>
                <div className="tile-value">{fmtGWh(plan.day.planMWh)}</div>
                <div className="tile-sub">Sum of the hourly P{confidence} plan for the delivery day</div>
              </div>
              <div className="tile">
                <div className="tile-label">Additional energy to procure vs the raw forecast</div>
                <div className="tile-value">{extra != null ? `${extra >= 0 ? "+" : "−"}${fmtGWh(Math.abs(extra))}` : "–"}</div>
                <div className="tile-sub">Raw forecast {fmtGWh(plan.day.rawForecastMWh)} minus the plan{extra != null ? ` (${Math.round(extra).toLocaleString("en-GB")} MWh)` : ""}</div>
              </div>
            </div>
            <p className="plan-honest">
              In January, wind came in at or above this level in <strong>{fmtPct(level.januaryHitRate)}</strong> of hours (target {confidence}%)
              {level.developmentHitRate != null
                ? <>; over Nov 2025 – Sep 2026, in <strong>{fmtPct(level.developmentHitRate)}</strong>.</>
                : <>. The Nov 2025 – Sep 2026 figure was measured at the 09:00/09:20 cutoffs only.</>}
            </p>
            <p className="muted">The cautious plans run slightly short because whole-day drops in wind (consistent with curtailment) are more frequent than the previous week's errors suggest.</p>
          </div>
        )
      )}
    </section>
  );
}
