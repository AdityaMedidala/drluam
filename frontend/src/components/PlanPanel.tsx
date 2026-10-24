import type { DayResponse, PlanResponse } from "../api";
import { fmtDate, fmtDateTime, fmtGWh0, fmtPct } from "../format";
import { ErrorState, Loading, withUnit } from "./ui";

export const CONFIDENCES = [50, 70, 80, 90, 95];

/** The decision in one sentence and one number, with the confidence control and one line of support. */
export default function PlanPanel({ plan, day, error, confidence, onConfidence }: {
  plan: PlanResponse | null; day: DayResponse | null; error: string | null;
  confidence: number; onConfidence: (c: number) => void;
}) {
  const level = plan?.calibration.find((r) => r.confidence === confidence);
  const extra = plan?.day.extraToProcureMWh;
  const partial = day != null && day.historyPoints < day.historyPointsFull;
  const pooled = level?.developmentHitRate != null;

  return (
    <section className="hero" aria-label="Plan">
      {error && <ErrorState error={error} />}
      {!plan && !error && <Loading rows={1} />}
      {plan && level && (plan.day.planMWh == null ? (
        <h2>Not enough history before {fmtDate(plan.date)} to build a plan.</h2>
      ) : (
        <h2>
          Plan on <span className="display">{withUnit(fmtGWh0(plan.day.planMWh))}</span> of wind for {fmtDate(plan.date)}
          {extra != null && <> — <span className="nowrap">{fmtGWh0(Math.abs(extra))}</span> {extra >= 0 ? "less" : "more"} than the raw forecast.</>}
        </h2>
      ))}

      <div className="seg" role="radiogroup" aria-label="Planning confidence">
        {CONFIDENCES.map((c) => (
          <button key={c} role="radio" aria-checked={c === confidence} onClick={() => onConfidence(c)}
            aria-label={`P${c}: plan on wind with ${c}% confidence`}>P{c}</button>
        ))}
      </div>

      {plan && level && plan.day.planMWh != null && (
        <p className="hero-sub">
          Expected {fmtGWh0(plan.day.adjustedMWh)} · held {fmtPct(pooled ? level.developmentHitRate : level.januaryHitRate)} of hours
          at P{confidence} ({pooled ? "Nov 2025–Sep 2026" : "January 2026"})
        </p>
      )}
      {partial && (
        <p className="note-warn" role="note">Partial history ({day!.historyPoints} of {day!.historyPointsFull} hours): the plan rests on less than a full week.</p>
      )}
      {day?.forecastPublishedUtc && (
        <p className="context">
          Using the forecast published {fmtDateTime(day.forecastPublishedUtc)} UK
          {day.horizonHours ? `, ${day.horizonHours[0]}–${day.horizonHours[1]} h ahead` : ""}.
        </p>
      )}
    </section>
  );
}
