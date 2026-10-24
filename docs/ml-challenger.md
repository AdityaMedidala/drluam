# ML challenger: LightGBM quantile regression vs the current method

Analysis only. The app does not change, whatever the result.

**Status: pre-registered on 24 Oct 2026, before any model was trained and before any October 2026 data was fetched.** Everything below the results line is filled in afterwards. The rule above it is not edited after this commit.

## Pre-registered rule

### Challenger

LightGBM quantile regression predicting the **outturn** (FUELHH wind, MW, on the same hourly alignment as the app). One model per quantile level: α = 0.05, 0.10, 0.20, 0.30, 0.50, 0.90. These give P10, P50 and P90 (α = 0.10, 0.50, 0.90) and the five exceedance levels (P50, P70, P80, P90, P95 = α 0.50, 0.30, 0.20, 0.10, 0.05). Per row, the six predictions are sorted to remove quantile crossing, then floored at 0 MW.

Fixed hyperparameters, not tuned on any month: `lightgbm==4.6.0`, `objective="quantile"`, `n_estimators=400`, `learning_rate=0.05`, `num_leaves=31`, `min_child_samples=100`, `random_state=0`, `deterministic=True`, `force_row_wise=True`, all other parameters at their defaults.

### Features

All are known at the decision time, 09:20 UK on D−1, for each target hour on delivery day D:

1. **Forecast level**: the decision-run forecast for the hour (the app's selection: latest WINDFOR run published at or before the decision time).
2. **Hour of day** of the target hour (UK local) and **day of week** of the delivery day.
3. **Lead time**: hours from the decision run's publication to the target hour.
4. **Revision**: the decision-run forecast minus the previous run's forecast for the same hour. The previous run is the latest run published before the decision run that covers the hour. Missing if there is none.
5. **Trailing 7-day ratio**: Σ outturn / Σ forecast, the app's bias-correction ratio (outturn known at the decision time only, startTime + 30 min ≤ decision time, at least 24 hours).
6. **Trailing 7-day mean error**: mean of (forecast − outturn) over the same hours, using each history hour's own decision forecast.

### Training and development evaluation

- **Expanding window from Jan 2025**: training rows are delivery days from 1 Jan 2025. For decision month M, the models are retrained once, on every row whose delivery day ends before M's first decision date, so every target is known at every decision in M.
- Data: the Jan–Oct 2025 vault files (`analysis/vault-2025/`) are used **as training data only**. The vault was spent as a test set on 24 Oct 2026 (`docs/data-usage.md`) and no month in it is evaluated here.
- **Development evaluation**: rolling, decision months Nov 2025 – Sep 2026 (month = decision month, D−1, as in `docs/plan-backtest.md`).
- **Scored hours**: those with an outturn where the current method has a full week of residuals (168), the same 7,775 development hours as `docs/plan-backtest.md`. Both methods are scored on exactly the same hours.
- **Current method**: the app's, unchanged (`backend/app/analysis.py`). Its quantiles are the planning volumes at α = 0.05–0.50 (bias-corrected forecast + the α quantile of the trailing week's out-of-sample residuals, floored at 0), and the 80% range's high edge at α = 0.90. Its P50 is the P50 planning volume.

### Metrics

- **MAE (P50)**: mean |P50 − outturn|, in MW.
- **Pinball loss**: mean quantile loss over α = 0.10, 0.50 and 0.90, in MW.
- **Coverage**: share of hours with outturn inside [P10, P90] (target 80%).
- **Uncertainty**: day-block bootstrap of the challenger − current difference in MAE and in pinball loss: 10,000 resamples of delivery days, seed 0, 95% percentile intervals. **The intervals are reported but are not part of the decision rule.**

### Confirmation: one run on October 2026

- **Data**: fetched with `backend/scripts/fetch_data.py` only after this commit, into `analysis/data-2026-10/`.
- **Period**: decisions from 1 Oct 2026, i.e. delivery days from 2 Oct 2026, up to the latest delivery day with all 48 outturn periods. Delivery day 1 Oct is excluded because it already belongs to the September decision month.
- **Model**: trained once, on every row delivered before 1 Oct 2026 (the expanding window).
- **Run**: applied exactly once, mechanically.

**Adoption-worthy only if all three hold on October:**

1. challenger MAE (P50) **<** current MAE (P50);
2. challenger pinball loss **<** current pinball loss;
3. challenger P10–P90 coverage between **75% and 85%** inclusive.

Otherwise it is **not adoption-worthy**. Either way the verdict is recorded here. "Adoption-worthy" only means it earns a proper, pre-registered trial on later data. Nothing is adopted into the app on the strength of a few weeks.

### Leakage guards

- **Feature timing test**: every feature row records the latest timestamp of information it used:
  - the decision run's publication time;
  - the previous run's publication time;
  - the latest history outturn's end time.

  A test asserts that this is at or before the row's decision time, and that every training row's delivery day ends before the first decision of the month it is used for.
- **Shuffled-time sanity check**: on one development month (Jan 2026), a model trained on targets randomly permuted across time must lose its skill. Its P50 MAE must be worse than both the real model's and the current method's. If not, the pipeline is suspect and that is reported.

### Also reported (not part of the rule)

- Development results per month.
- Feature importance, in plain words.
- The cost backtest at £100 short / £30 long per MWh (`docs/cost-backtest.md`), at each exceedance level, for both methods.
- Training time.

---

## Results

_Not yet run._
