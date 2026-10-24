import { Accordion, AccordionItem, Link, NumberInput, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@carbon/react";
import { useEffect, useState } from "react";
import { api, type CostResponse, type CostRow } from "../api";
import { ErrorState, Loading } from "./ui";

export const DEFAULT_COSTS = { short: 100, long: 30 };   // GBP/MWh, illustrative desk assumptions
export const MAX_COST = 10_000;
export const validCost = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_COST;

const rowLabel = (r: CostRow) =>
  r.confidence ? `P${r.confidence}` : r.key === "forecast" ? "NESO forecast" : "Bias-corrected forecast";
const gbpM = (v: number) => (v / 1e6).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedGbpM = (v: number) => (Math.abs(v) < 5e4 ? "0.0" : `${v < 0 ? "−" : "+"}${gbpM(Math.abs(v))}`);

/** A £/MWh field that keeps what is typed and reports only valid values. */
function CostInput({ id, label, value, onValue }: { id: string; label: string; value: number; onValue: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (Number(draft) !== value) setDraft(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <NumberInput id={id} size="sm" label={label} min={1} max={MAX_COST} step={5} hideSteppers allowEmpty
      value={draft} invalid={!validCost(Number(draft))} invalidText={`Enter £1 to £${MAX_COST.toLocaleString("en-GB")}`}
      onChange={(_e: unknown, { value: v }: { value: number | string }) => {
        setDraft(String(v));
        if (validCost(Number(v))) onValue(Number(v));
      }} />
  );
}

/** Cost-aware exceedance level: the newsvendor recommendation and what each plan would have cost in January. */
export default function CostPanel({ cutoff, short, long, confidence, onCosts, onUseLevel }: {
  cutoff: string; short: number; long: number; confidence: number;
  onCosts: (short: number, long: number) => void; onUseLevel: (level: number) => void;
}) {
  const [data, setData] = useState<CostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.cost(cutoff, short, long).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [cutoff, short, long]);

  const rec = data?.recommended;
  const bt = data?.backtest;
  const exact = rec ? Math.round(rec.exact) : null;
  const recRow = bt?.rows.find((r) => r.confidence === rec?.level);
  const money = (n: number) => `£${n.toLocaleString("en-GB")}`;
  return (
    <section aria-label="Cost-aware exceedance level" className="cost">
      <div className="label">Cost-aware exceedance level</div>
      {error && <ErrorState error={error} />}
      {!data && !error && <Loading height={48} />}
      {rec && bt && (
        <p className="cost-rec">
          At {money(short)} short and {money(long)} long per MWh (desk assumptions, illustrative){" "}
          {rec.snapped
            ? <>the cost ratio gives P{exact}. That is below P50, so P50 is recommended.</>
            : exact === rec.level
              ? <>the recommended level is P{rec.level}.</>
              : <>the recommended level is P{exact}, nearest offered P{rec.level}.</>}
          {bt.bestLevel !== rec.level && <> Lowest backtest cost at P{bt.bestLevel}.</>}
          {" "}
          {confidence === rec.level
            ? <span className="target">In use.</span>
            : <Link href="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); onUseLevel(rec.level); }}>Use P{rec.level}</Link>}
        </p>
      )}
      <Accordion size="sm" className="cost-backtest">
        <AccordionItem title="Costs and backtest">
          <fieldset className="cost-inputs">
            <legend className="cds--label">Desk assumptions, illustrative</legend>
            <CostInput id="cost-short" label="Cost of being short (£/MWh)" value={short} onValue={(n) => onCosts(n, long)} />
            <CostInput id="cost-long" label="Cost of being long (£/MWh)" value={long} onValue={(n) => onCosts(short, n)} />
          </fieldset>
          {rec && bt && (
            <>
              <Table size="xs" className="num-table cost-table" aria-label={`Backtest cost of each plan, January 2026 at ${cutoff}`}>
                <TableHead>
                  <TableRow>
                    <TableHeader>Plan on</TableHeader>
                    <TableHeader>Cost (£m)</TableHeader>
                    <TableHeader>vs NESO (£m)</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bt.rows.map((r) => (
                    <TableRow key={r.key} className={r.key === bt.lowest ? "lowest" : undefined}>
                      <TableCell>{rowLabel(r)}{r.key === bt.lowest && <span className="cds--visually-hidden"> (lowest cost)</span>}</TableCell>
                      <TableCell>{gbpM(r.costGBP)}</TableCell>
                      <TableCell>{r.key === "forecast" ? "–" : signedGbpM(r.vsNesoGBP)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="cost-note">
                January 2026, {bt.hours.toLocaleString("en-GB")} hours at {cutoff}. Lowest cost highlighted.
                {recRow && recRow.vsNesoGBP < 0 && <> P{rec.level} would have cost £{gbpM(-recRow.vsNesoGBP)}m less than the NESO forecast in this backtest, at these assumptions.</>}
              </p>
            </>
          )}
        </AccordionItem>
      </Accordion>
    </section>
  );
}
