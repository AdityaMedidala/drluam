import { DefinitionTooltip, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper } from "@carbon/react";
import type { DayResponse, PlanResponse } from "../api";
import { fmtDate, fmtGWh0, fmtPct } from "../format";
import { adjustedName, useModel } from "../model";
import { ErrorState, Loading } from "./ui";

export const CONFIDENCES = [50, 70, 80, 90, 95];

const UK = "Europe/London";
const runTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK }) + " " +
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: UK });

/** The decision: one big number, its delta from the raw forecast, and the few figures behind it. */
export default function PlanPanel({ plan, day, error, confidence, showActual }: {
  plan: PlanResponse | null; day: DayResponse | null; error: string | null; confidence: number; showActual: boolean;
}) {
  const model = useModel();
  if (error) return <ErrorState error={error} />;
  if (!plan) return <Loading height={260} />;
  const level = plan.calibration.find((r) => r.confidence === confidence);
  const pooled = level?.developmentHitRate != null;
  const hit = pooled ? level?.developmentHitRate : level?.januaryHitRate;
  const extra = plan.day.extraToProcureMWh;
  const partial = day != null && day.historyPoints < day.historyPointsFull;

  if (plan.day.planMWh == null) {
    return <p className="label">Insufficient history before {fmtDate(plan.date)} for a planning volume.</p>;
  }
  return (
    <section aria-label="Plan">
      <div className="label">P{confidence} planning volume · {fmtDate(plan.date)}</div>
      <p className="hero">{Math.round(plan.day.planMWh / 1000).toLocaleString("en-GB")}<span className="unit">GWh</span></p>
      <StructuredListWrapper isCondensed aria-label="Figures behind the plan" className="decision-list">
        <StructuredListBody>
          <StructuredListRow>
            <StructuredListCell>NESO forecast</StructuredListCell>
            <StructuredListCell>{fmtGWh0(plan.day.rawForecastMWh)}</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell>{adjustedName(model)}</StructuredListCell>
            <StructuredListCell>{fmtGWh0(plan.day.adjustedMWh)}</StructuredListCell>
          </StructuredListRow>
          {extra != null && (
            <StructuredListRow>
              <StructuredListCell>Δ vs NESO forecast</StructuredListCell>
              <StructuredListCell>{extra > 0 ? "−" : extra < 0 ? "+" : ""}{fmtGWh0(Math.abs(extra))}</StructuredListCell>
            </StructuredListRow>
          )}
          <StructuredListRow>
            <StructuredListCell>
              <DefinitionTooltip openOnHover align="bottom-left"
                definition={pooled
                  ? "Share of hours with outturn at or above the planning volume, Nov 2025–Sep 2026 backtest (7,775 hours, same model)."
                  : "Share of January 2026 hours with outturn at or above the planning volume (the longer backtest covers the 09:00/09:20 decision times only)."}>
                P{confidence} hit rate (backtest)
              </DefinitionTooltip>
            </StructuredListCell>
            <StructuredListCell>{fmtPct(hit)} <span className="target">(target {confidence}%)</span></StructuredListCell>
          </StructuredListRow>
          {showActual && day && (
            <StructuredListRow>
              <StructuredListCell>Outturn</StructuredListCell>
              <StructuredListCell>{fmtGWh0(day.summary.actualEnergyMWh)}</StructuredListCell>
            </StructuredListRow>
          )}
        </StructuredListBody>
      </StructuredListWrapper>
      {partial && <p className="warn" role="note">Partial history, {day!.historyPoints} of {day!.historyPointsFull} hours in the correction window.</p>}
      {day?.forecastPublishedUtc && day.horizonHours && (
        <p className="run">NESO forecast run {runTime(day.forecastPublishedUtc)} · {Math.floor(day.horizonHours[0])}–{Math.ceil(day.horizonHours[1])} h ahead</p>
      )}
    </section>
  );
}
