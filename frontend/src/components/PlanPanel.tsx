import { DefinitionTooltip, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper } from "@carbon/react";
import type { DayResponse, PlanResponse } from "../api";
import { fmtDate, fmtGWh0, fmtPct } from "../format";
import { ErrorState, Loading } from "./ui";

export const CONFIDENCES = [50, 70, 80, 90, 95];

const UK = "Europe/London";
const runTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK }) + " " +
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: UK });

/** The decision: one big number, its delta from the raw forecast, and the few figures behind it. */
export default function PlanPanel({ plan, day, error, confidence }: {
  plan: PlanResponse | null; day: DayResponse | null; error: string | null; confidence: number;
}) {
  if (error) return <ErrorState error={error} />;
  if (!plan) return <Loading height={260} />;
  const level = plan.calibration.find((r) => r.confidence === confidence);
  const pooled = level?.developmentHitRate != null;
  const hit = pooled ? level?.developmentHitRate : level?.januaryHitRate;
  const extra = plan.day.extraToProcureMWh;
  const partial = day != null && day.historyPoints < day.historyPointsFull;

  if (plan.day.planMWh == null) {
    return <p className="label">Not enough history before {fmtDate(plan.date)} to build a plan.</p>;
  }
  return (
    <section aria-label="Plan">
      <div className="label">Wind to plan on · {fmtDate(plan.date)}</div>
      <p className="hero">{Math.round(plan.day.planMWh / 1000).toLocaleString("en-GB")}<span className="unit">GWh</span></p>
      {extra != null && <p className="delta">{fmtGWh0(Math.abs(extra))} {extra >= 0 ? "less" : "more"} than the raw forecast</p>}
      <StructuredListWrapper isCondensed aria-label="Figures behind the plan" className="decision-list">
        <StructuredListBody>
          <StructuredListRow>
            <StructuredListCell>Raw forecast</StructuredListCell>
            <StructuredListCell>{fmtGWh0(plan.day.rawForecastMWh)}</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell>Expected (adjusted)</StructuredListCell>
            <StructuredListCell>{fmtGWh0(plan.day.adjustedMWh)}</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell>
              <DefinitionTooltip openOnHover align="bottom-left"
                definition={pooled
                  ? "Share of hours the actual came in at or above the plan, Nov 2025–Sep 2026 (7,775 hours, same method run offline)."
                  : "Share of January 2026 hours the actual came in at or above the plan (the longer backtest covers the 09:00/09:20 cutoffs only)."}>
                Backtest hit rate (P{confidence})
              </DefinitionTooltip>
            </StructuredListCell>
            <StructuredListCell>{fmtPct(hit)}</StructuredListCell>
          </StructuredListRow>
        </StructuredListBody>
      </StructuredListWrapper>
      {partial && <p className="warn" role="note">Partial history ({day!.historyPoints} of {day!.historyPointsFull} h): plan rests on less than a week.</p>}
      {day?.forecastPublishedUtc && day.horizonHours && (
        <p className="run">Forecast run {runTime(day.forecastPublishedUtc)} · {Math.floor(day.horizonHours[0])}–{Math.ceil(day.horizonHours[1])} h ahead</p>
      )}
    </section>
  );
}
