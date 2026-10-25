import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@carbon/react";
import { useEffect, useState } from "react";
import { api, type AccuracyResponse, type CostResponse } from "../api";
import { fmtMW, fmtPct, fmtSignedMW } from "../format";
import { ML_CUTOFFS, MODELS, modelLabel, type Model } from "../model";
import { DEFAULT_COSTS } from "./CostPanel";
import { ErrorState, Loading } from "./ui";

type Both = Record<Model, { acc: AccuracyResponse; cost: CostResponse }>;
const LEVEL = 80;   // the default exceedance level

/** Simple vs ML on January 2026, side by side, whichever model is selected (ADR-001). */
export default function ModelComparison({ cutoff }: { cutoff: string }) {
  const [data, setData] = useState<Both | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = ML_CUTOFFS.includes(cutoff);

  useEffect(() => {
    if (!available) return;
    let live = true;
    setData(null);
    setError(null);
    Promise.all(MODELS.map((m) => Promise.all([api.accuracy(cutoff, m), api.cost(cutoff, DEFAULT_COSTS.short, DEFAULT_COSTS.long, m)])))
      .then(([[sa, sc], [ma, mc]]) => live && setData({ simple: { acc: sa, cost: sc }, ml: { acc: ma, cost: mc } }))
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [cutoff, available]);

  const p90 = (a: AccuracyResponse) => a.planCalibration.find((r) => r.confidence === 90)?.januaryHitRate;
  const cost = (c: CostResponse) => c.backtest.rows.find((r) => r.confidence === LEVEL)?.costGBP;
  const rows: [string, (b: Both[Model]) => string][] = [
    ["MAE", (b) => fmtMW(b.acc.comparison.adjusted.mae)],
    ["Mean error", (b) => fmtSignedMW(b.acc.comparison.adjusted.bias)],
    ["80% range coverage (target 80%)", (b) => fmtPct(b.acc.band.coverage)],
    ["P90 hit rate (target 90%)", (b) => fmtPct(p90(b.acc))],
    [`Cost of the P${LEVEL} plan at £${DEFAULT_COSTS.short} short / £${DEFAULT_COSTS.long} long`, (b) => {
      const v = cost(b.cost);
      return v == null ? "–" : `£${(v / 1e6).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`;
    }],
  ];

  return (
    <section className="model-compare" aria-label="Simple vs ML">
      <h2 className="chart-title">Simple vs ML · January 2026</h2>
      {!available && <p className="sub">The ML model covers the 09:00 and 09:20 decision times only.</p>}
      {available && error && <ErrorState error={error} />}
      {available && !data && !error && <Loading height={120} />}
      {available && data && (
        <>
          <Table size="xs" className="num-table compare-table" aria-label={`Simple vs ML, January 2026 at ${cutoff}`}>
            <TableHead>
              <TableRow>
                <TableHeader>Measure</TableHeader>
                {MODELS.map((m) => <TableHeader key={m}>{modelLabel(m)}</TableHeader>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(([label, value]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  {MODELS.map((m) => <TableCell key={m}>{value(data[m])}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="cost-note">
            {data.simple.acc.comparison.adjusted.n.toLocaleString("en-GB")} hours at {cutoff}. MAE and mean error are of the bias-corrected forecast (Simple) and the ML forecast (P50). Cost is GB-wide volume at illustrative prices.
          </p>
        </>
      )}
    </section>
  );
}
