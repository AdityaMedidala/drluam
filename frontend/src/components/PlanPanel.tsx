import type { DayResponse, PlanResponse } from "../api";
import { fmtGWh, fmtPct } from "../format";
import { ErrorState, Loading } from "./ui";

export const CONFIDENCES = [50, 70, 80, 90, 95];

/** "How much wind should the desk plan on?" at a chosen confidence, with the hit rate it really achieved. */
export default function PlanPanel({ plan, day, error, confidence, onConfidence }: {
  plan: PlanResponse | null; day: DayResponse | null; error: string | null;
  confidence: number; onConfidence: (c: number) => void;
}) {
  const level = plan?.calibration.find((r) => r.confidence === confidence);
  const extra = plan?.day.extraToProcureMWh;
  const ratio = day?.correctionRatio;
  const partial = day != null && day.historyPoints < day.historyPointsFull;
  // Miss rate = 1 - hit rate, pooled Nov 2025 - Sep 2026 where measured, else January.
  const pooledTail = plan?.calibration.every((r) => r.developmentHitRate != null) ?? false;
  const miss = (c: number) => {
    const r = plan?.calibration.find((x) => x.confidence === c);
    const hit = pooledTail ? r?.developmentHitRate : r?.januaryHitRate;
    return hit == null ? null : 1 - hit;
  };

  return (
    <section className="card plan">
      <div className="plan-levels" role="radiogroup" aria-label="Planning confidence">
        {CONFIDENCES.map((c) => {
          const r = plan?.calibration.find((x) => x.confidence === c);
          // "held" is the pooled Nov 2025 – Sep 2026 rate; where it wasn't measured (other cutoffs), say January.
          const pooled = r?.developmentHitRate != null;
          const held = pooled ? r?.developmentHitRate : r?.januaryHitRate;
          const period = pooled ? "Nov 2025 – Sep 2026" : "January 2026";
          return (
            <button key={c} role="radio" aria-checked={c === confidence} onClick={() => onConfidence(c)}
              aria-label={`P${c}: target ${c}% of hours, held ${fmtPct(held)} of hours in ${period}`} title={`Held in ${period}`}>
              <strong>P{c}</strong>
              <span className="muted">{pooled ? "held" : "Jan"} {fmtPct(held)}</span>
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
            <div className="ladder">
              <div className="rung">
                <span className="muted">Raw forecast</span>
                <strong>{fmtGWh(plan.day.rawForecastMWh)}</strong>
              </div>
              <span className="ladder-arrow" aria-hidden>→</span>
              <div className="rung">
                <span className="muted">Expected (adjusted)</span>
                <strong>{fmtGWh(plan.day.adjustedMWh)}</strong>
              </div>
              <span className="ladder-arrow" aria-hidden>→</span>
              <div className="rung rung-plan">
                <span className="muted">Plan on (P{confidence})</span>
                <strong>{fmtGWh(plan.day.planMWh)}</strong>
              </div>
            </div>
            <p className="ladder-gap">
              Extra to buy vs. trusting the raw forecast:{" "}
              <strong>{extra != null ? `${extra >= 0 ? "+" : "−"}${fmtGWh(Math.abs(extra))}` : "–"}</strong>
            </p>
            {partial && (
              <p className="tile-note" role="note">
                Partial history ({day!.historyPoints} of {day!.historyPointsFull} hours): the adjustment and plan rest on less than a full week.
              </p>
            )}
            <p className="plan-honest">
              Backtested: wind came in at or above the P{confidence} plan in{" "}
              {level.developmentHitRate != null
                ? <><strong>{fmtPct(level.developmentHitRate)}</strong> of hours (Nov 2025–Sep 2026); <strong>{fmtPct(level.januaryHitRate)}</strong> in January.</>
                : <><strong>{fmtPct(level.januaryHitRate)}</strong> of January hours (target {confidence}%). The Nov 2025–Sep 2026 figure was measured at the 09:00/09:20 cutoffs only.</>}
            </p>
            <p className="muted">
              The cautious plans over-promise in the tail: the P90 plan was missed in {fmtPct(miss(90))} of hours (promised 10%) and P95 in {fmtPct(miss(95))} (promised 5%){pooledTail ? "" : " in January"}, because whole-day shortfalls in metered wind output are more frequent than the previous week's errors suggest.
            </p>
            <details className="table-toggle">
              <summary>How is this calculated?</summary>
              <ul className="plan-method">
                <li><strong>Raw forecast:</strong> the day's total from the latest Elexon WINDFOR forecast published at or before the cutoff (hourly MW × 1 h).</li>
                <li><strong>Expected (adjusted):</strong> raw forecast × {ratio != null ? ratio.toFixed(2) : "the ratio"}, the ratio of actual to forecast wind over the previous 7 days, using only actuals known at the cutoff{ratio != null ? <> (actual came in {fmtPct(Math.abs(1 - ratio))} {ratio < 1 ? "below" : "above"} forecast)</> : null}.</li>
                <li><strong>Plan on (P{confidence}):</strong> for each hour, the adjusted forecast + the {100 - confidence}th percentile of the last 7 days' hourly misses (actual − adjusted forecast, positive or negative), never below 0; summed over the day.</li>
                <li><strong>Extra to buy:</strong> raw forecast − plan.</li>
                <li><strong>Held / backtested:</strong> the share of past hours whose actual came in at or above the plan. January 2026 is the app's own data; Nov 2025–Sep 2026 (7,775 hours) comes from the same method run offline on those months. Past results, not a guarantee.</li>
              </ul>
            </details>
          </div>
        )
      )}
    </section>
  );
}
