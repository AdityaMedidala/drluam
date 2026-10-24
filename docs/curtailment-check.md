# Curtailment check: does the gap close when curtailed wind is added back?

**Short answer: mostly, yes.** In January 2026, wind farms were turned down through accepted balancing-mechanism bids by an average of **1,524 MW**, which is **87% of the 1,746 MW** mean gap between the decision-time forecast and metered output. Adding those volumes back to FUELHH cuts the raw forecast's bias from **+1,746 to +221 MW** and its MAE from **2,022 to 1,147 MW**, and the forecast is too high in 55% of hours instead of 85%. Above 15 GW of forecast the gap drops to about zero and slightly overshoots (−263 MW).

This uses data outside the brief (Elexon BOAV), so it lives in `analysis/` and is never used by the app. The app's numbers are unchanged.

## Why this test

FUELHH WIND is metered output, so it is net of any bids the system operator accepted to turn wind farms down. If WINDFOR forecasts what the farms *could* generate, the gap should shrink once those accepted volumes are added back. Adding wind BM-unit bid volumes back to metered output is the test used in the literature, and NESO itself scores its wind forecast only on units without bid-offer acceptances. Before this check the README called curtailment a hypothesis.

## Method

- **Forecast and actuals:** the app's own January snapshot and logic, decision cutoff 09:20 UK, delivery days 2 Jan – 1 Feb 2026, the same 744 hours as the app's headline.
- **Curtailment:** Elexon BOAV (bid-offer acceptance volumes) per BM unit and settlement period, from `/balancing/settlement/acceptance/volumes/all/bid/{settlementDate}`, for every settlement date in that range. Kept for BM units whose `fuelType` is `WIND` in Elexon's BM unit reference list (239 units; 100 of them had accepted bids). Bid volumes are negative MWh per half-hour; curtailed MW = −volume ÷ 0.5 h. Joined to the forecast hour by half-hour start time, the same exact-timestamp join the app uses.
- **Check on the source:** for 28 Jan the BOAV wind total (−33,940 MWh) equals the "Tagged" total in the related DISPTAV dataset exactly, so the figure is not double-counted across DISPTAV's four data types.
- **Scale check:** accepted wind bids total 1.12 TWh over 2–31 Jan. NESO reports 1.5 TWh of curtailment for March 2026, and The Energyst reports 10.2 TWh for 2025 (about 1.2 GW on average), so January's roughly 1.56 GW average sits in the expected range. The largest volumes are on Scottish offshore farms (Seagreen, Moray East), consistent with Scottish transmission constraints being the main driver of wind curtailment.
- **Against NESO's constraint figures:** over the same delivery days (2 Jan – 1 Feb), accepted wind bids (1.52 GW on average) are about 75% of NESO's all-fuel thermal-constraint volume (2.02 GW; 2.16 GW for calendar January, −1,606,376 MWh), and the two move together day by day (correlation 0.96), consistent with wind being most of it. Source: NESO data portal, "Constraint Breakdown Costs and Volume", 2025–2026 resource, fetched 24 Oct 2026 into `analysis/neso/` (CSV not in git; manifest with sha256). The two are not the same measure: NESO's figure covers all fuels and only thermal-constraint actions, while BOAV covers every accepted wind bid.
- **Reproduce:** `python analysis/curtailment_check.py --fetch` (downloads about 220 MB, keeps about 2 MB), then `python analysis/curtailment_check.py`. The CSV is not in git; `analysis/curtailment/manifest.json` records its row count and sha256.

## Results (January 2026, 744 hours)

| | bias | MAE | hours over-forecast |
|---|---|---|---|
| Raw forecast vs FUELHH actual (the app) | +1,746 MW | 2,022 MW | 85% |
| Raw forecast vs actual + accepted wind bids | +221 MW | 1,147 MW | 55% |

Accepted wind bids were non-zero in 73% of hours. The 87% is a share of the average gap; hour by hour the absolute error falls 43% (MAE 2,022 → 1,147 MW). Day by day, the mean gap and the mean accepted bids are correlated at 0.69 (Pearson) and 0.68 (Spearman).

### By forecast level

| forecast level | hours | mean gap (MW) | mean accepted bids (MW) | gap after adding back (MW) |
|---|---|---|---|---|
| <5 GW | 31 | +579 | 0 | +579 |
| 5–10 GW | 214 | +772 | 348 | +424 |
| 10–15 GW | 201 | +1,574 | 904 | +670 |
| >15 GW | 298 | +2,683 | 2,946 | −263 |

This explains the level effect in `docs/error-anatomy.md`: the actual/forecast ratio falls at high forecast levels because that is when wind is curtailed. Below 15 GW a gap of roughly 0.4–0.7 GW remains that accepted bids do not explain.

### The four days the band missed entirely

| delivery day | forecast | actual | accepted bids | gap | gap after | actual/forecast | after adding back |
|---|---|---|---|---|---|---|---|
| 2 Jan | 18,279 | 15,209 | 2,063 | +3,070 | +1,007 | 0.83 | 0.94 |
| 11 Jan | 18,359 | 13,506 | 5,426 | +4,853 | −573 | 0.74 | 1.03 |
| 21 Jan | 19,390 | 15,713 | 2,747 | +3,677 | +930 | 0.81 | 0.95 |
| 28 Jan | 11,135 | 5,806 | 1,446 | +5,329 | +3,883 | 0.52 | 0.65 |

(Daily means, MW.) On 2, 11 and 21 Jan curtailment accounts for most or all of the miss. **28 Jan is not explained by curtailment**: even after adding accepted bids back, actual output was only 65% of the forecast. These datasets don't show why.

## What this does and doesn't show

- **It strongly supports curtailment as the main cause of the systematic gap**, which matches how the data are defined: FUELHH is metered (post-curtailment) output.
- **It does not prove WINDFOR is an unconstrained forecast.** No Elexon or NESO statement says so; the result is what you would expect if it were.
- **The bid volumes are approximate curtailment.** They are measured against each unit's final physical notification, which is the unit's own expectation, not an exact measure of what it could have generated, so they can be too high or too low. At high wind the add-back looks slightly generous: above 15 GW of forecast, actual plus bids exceeds the forecast in 61% of hours, and by more than 2 GW in 53 hours, so the 87% may be a few points high. This data can't separate that from WINDFOR under-forecasting at high wind. The volumes also include any wind bids accepted for energy balancing, not only constraints. Wind BM units missing from Elexon's reference list, or not tagged `WIND`, are not counted.
- **One month.** The test was run on January 2026 only, the app's scope.
- **It is not a better forecast.** Curtailment volumes are known only after the fact, so they can't be added at decision time. What the result changes is the story: the "forecast error" the desk sees is mostly the grid turning wind down, which the app's trailing-week ratio partly learns. Forecasting curtailment directly (for example from constraint forecasts) would be the next step.
