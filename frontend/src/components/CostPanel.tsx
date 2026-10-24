import {
  Accordion, AccordionItem, Link, NumberInput, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag,
} from "@carbon/react";
import { Checkmark } from "@carbon/icons-react";
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
  const dev = data?.development ?? null;
  // Displayed theory level: never "P50" for a ratio that snapped, never "P100".
  const theory = rec ? Math.min(Math.round(rec.exact), rec.snapped ? 49 : 99) : null;
  // Theory and the 11-month backtest: one level when they agree, both (unranked) when they don't.
  const candidates = rec ? [...new Set([rec.level, ...(dev ? [dev.bestLevel] : [])])].sort((a, b) => a - b) : [];
  const cost = (level: number) => bt?.rows.find((r) => r.confidence === level)?.costGBP ?? 0;
  const recRow = bt?.rows.find((r) => r.confidence === rec?.level);
  const use = (level: number) => (
    <Link href="#" className="cost-use" onClick={(e: React.MouseEvent) => { e.preventDefault(); onUseLevel(level); }}>Use P{level}</Link>
  );
  const match = <Checkmark size={16} className="cost-check" aria-label="matches theory" />;
  const vsNeso = recRow?.vsNesoGBP ?? 0;
  const value = candidates.map((c) => `P${c}`).join(" or ");
  return (
    <section aria-label="Cost-aware exceedance level" className="cost">
      <Accordion size="md" className="cost-accordion">
        <AccordionItem title={<span className="cost-row"><span>Level by cost<span className="cds--visually-hidden">,</span></span><span className="cost-row-value">{value}</span></span>}>
          {error && <ErrorState error={error} />}
          {!data && !error && <Loading height={48} />}
          {rec && bt && (
            <>
              <StructuredListWrapper isCondensed aria-label="Cost-aware level" className="decision-list cost-list">
                <StructuredListBody>
                  <StructuredListRow>
                    <StructuredListCell>Short · Long</StructuredListCell>
                    <StructuredListCell>£{short.toLocaleString("en-GB")} · £{long.toLocaleString("en-GB")} per MWh</StructuredListCell>
                  </StructuredListRow>
                  <StructuredListRow>
                    <StructuredListCell>Recommended</StructuredListCell>
                    <StructuredListCell>
                      {candidates.map((c) => `P${c}`).join(" or ")}{" "}
                      <span className="target">(theory P{theory}{rec.snapped ? ", snapped" : ""})</span>
                      {candidates.map((c) => c === confidence
                        ? <Tag key={c} size="sm" type="gray" className="cost-tag">{candidates.length > 1 ? `P${c} selected` : "Selected"}</Tag>
                        : <span key={c}> {use(c)}</span>)}
                    </StructuredListCell>
                  </StructuredListRow>
                  <StructuredListRow>
                    <StructuredListCell>11-month backtest</StructuredListCell>
                    <StructuredListCell>
                      {dev ? <>P{dev.bestLevel}{dev.bestLevel === rec.level && match}</> : <span className="target">Not measured at {cutoff}</span>}
                    </StructuredListCell>
                  </StructuredListRow>
                  <StructuredListRow>
                    <StructuredListCell>January only</StructuredListCell>
                    <StructuredListCell>
                      P{bt.bestLevel}
                      {bt.bestLevel === rec.level
                        ? match
                        : <>, £{gbpM(cost(rec.level) - cost(bt.bestLevel))}m less than P{rec.level}</>}
                    </StructuredListCell>
                  </StructuredListRow>
                </StructuredListBody>
              </StructuredListWrapper>
              <p className="cost-note">
                P{rec.level} would have cost {Math.abs(vsNeso) < 5e4
                  ? "about the same as"
                  : <>£{gbpM(Math.abs(vsNeso))}m {vsNeso < 0 ? "less" : "more"} than</>} the NESO forecast in this backtest, at these assumptions.
              </p>
            </>
          )}
          <fieldset className="cost-inputs">
            <legend className="cds--label">Desk assumptions, illustrative</legend>
            <CostInput id="cost-short" label="Short · £/MWh" value={short} onValue={(n) => onCosts(n, long)} />
            <CostInput id="cost-long" label="Long · £/MWh" value={long} onValue={(n) => onCosts(short, n)} />
          </fieldset>
          {rec && bt && (
            <>
              <p className="cds--label" id="cost-table-label">Cost (£m, GB-wide volume)</p>
              <Table size="xs" className="num-table cost-table" aria-labelledby="cost-table-label">
                <TableHead>
                  <TableRow>
                    <TableHeader>Plan on</TableHeader>
                    <TableHeader>Cost</TableHeader>
                    <TableHeader>vs NESO</TableHeader>
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
              <p className="cost-note">January 2026, {bt.hours.toLocaleString("en-GB")} hours at {cutoff}. Lowest cost highlighted.</p>
            </>
          )}
        </AccordionItem>
      </Accordion>
    </section>
  );
}
