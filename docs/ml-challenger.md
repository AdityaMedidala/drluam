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

Run on 24 Oct 2026 with `python analysis/ml_challenger.py dev`, then `python analysis/ml_challenger.py october` once. The October output is kept in `analysis/ml-challenger-october.json`. The October data was fetched at 18:18:32 UTC (`analysis/data-2026-10/manifest.json`), after the rule commit `80d3858` at 18:17:06 UTC. The leakage tests are in `analysis/tests/test_ml_challenger.py` (`python -m pytest analysis/tests`).

**One implementation note.** The models use LightGBM's native `lgb.train` with exactly the pre-registered parameters, not the scikit-learn wrapper the parameter names come from. The wrapper needs scikit-learn installed and would have added a dependency for nothing. Nothing else differs from the rule.

### Verdict on October 2026: NOT ADOPTION-WORTHY

Decisions 1–22 Oct 2026, delivery days 2–23 Oct (22 days, 528 hours). Model trained once on 15,311 hours delivered 1 Jan 2025 – 30 Sep 2026.

| condition | current method | challenger | ML − current, day-block 95% interval | holds? |
|---|---|---|---|---|
| 1. MAE (P50) lower | 1,533 MW | 1,383 MW | −150 MW [−460, +145] | yes |
| 2. pinball loss lower | 538 MW | 476 MW | −62 MW [−151, +25] | yes |
| 3. P10–P90 coverage within 75–85% | 72% | **49%** | – | **no** |

The challenger's middle and average quantiles are better, but both bootstrap intervals include zero over 22 days. Its 80% range is far too narrow: the outturn fell inside it in under half the hours. Under the rule that makes it not adoption-worthy, and nothing changes in the app.

### Development results (rolling, monthly retrain)

| decision month | hours | MAE current | MAE ML | pinball current | pinball ML | coverage current | coverage ML |
|---|---|---|---|---|---|---|---|
| 2025-11 | 480 | 1,689 | 1,756 | 559 | 606 | 70% | 38% |
| 2025-12 | 744 | 1,778 | 1,299 | 579 | 443 | 71% | 53% |
| 2026-01 | 744 | 1,532 | 1,308 | 541 | 439 | 69% | 54% |
| 2026-02 | 672 | 1,279 | 1,208 | 427 | 417 | 64% | 57% |
| 2026-03 | 743 | 1,103 | 1,232 | 368 | 425 | 73% | 48% |
| 2026-04 | 720 | 1,224 | 1,130 | 385 | 379 | 73% | 54% |
| 2026-05 | 744 | 1,076 | 979 | 342 | 299 | 68% | 62% |
| 2026-06 | 720 | 1,034 | 1,112 | 341 | 358 | 78% | 59% |
| 2026-07 | 744 | 968 | 949 | 330 | 319 | 75% | 66% |
| 2026-08 | 744 | 951 | 872 | 325 | 304 | 74% | 59% |
| 2026-09 | 720 | 1,506 | 1,374 | 468 | 457 | 63% | 52% |
| all | 7775 | 1,272 | 1,183 | 420 | 397 | 71% | 55% |

Pooled over the 11 months, ML − current: **MAE −89 MW [−168, −14]**, **pinball loss −22 MW [−53, +6]** (day-block bootstrap, 95%).

The pattern on October was already visible in development. The challenger's P50 beat the current method's in 8 of 11 months. But its range covered only 38–66% of hours, against 63–78% for the current method and an 80% target. The rule was fixed in advance, so nothing was tuned in response.

### What the model leans on (P50 model, share of total gain, mean of the 11 monthly models)

| feature | share |
|---|---|
| the decision-run forecast itself | 67% |
| last week's outturn-to-forecast ratio | 12% |
| last week's mean error | 11% |
| change since the previous run | 4% |
| day of week | 3% |
| hour of day | 1% |
| hours ahead | 1% |

In plain words, the model mostly corrects the forecast from the forecast's own level. Last week's ratio and mean error carry most of the rest. That is the same information the app's bias correction uses, applied hour by hour instead of as one scale factor. Calendar, revisions and lead time add little.

### Cost backtest at £100 short / £30 long per MWh (not part of the rule)

Development hours, pooled (£m):

| level | current | ML | ML - current |
|---|---|---|---|
| P50 | 649.0 | 575.9 | -73.1 |
| P70 | 531.0 | 487.0 | -44.0 |
| P80 | 524.5 | 459.7 | -64.7 |
| P90 | 562.1 | 457.3 | -104.8 |
| P95 | 612.9 | 480.5 | -132.4 |

October 2026 (528 hours, £m):

| level | current | ML | ML − current |
|---|---|---|---|
| P50 | 45.0 | 44.7 | −0.3 |
| P70 | 38.8 | 39.7 | +0.9 |
| P80 | 41.1 | 38.3 | −2.8 |
| P90 | 51.4 | 38.4 | −13.0 |
| P95 | 56.5 | 39.0 | −17.5 |

The challenger's high levels cost less mainly because they sit lower. Its upper-tail quantiles are not really P90 or P95: they are met far less often than claimed (see the coverage). So these lower costs come from different, mislabelled plans, not from a better P90. As in `docs/cost-backtest.md`, the £ figures are national GB wind volumes, not any one buyer's exposure. They mean only "would have cost £X less in this backtest at these assumptions".

### Leakage guards

- **Feature timing:** every feature row's latest-information timestamp is at or before its decision time, on synthetic data and on all 2025–2026 rows. Training rows always end before the first decision of the month they serve.
- **Scrambling test:** randomising every forecast and outturn after a day's decision time leaves that day's features unchanged. A copy of the script with a deliberately leaky history window (12 hours past the decision) fails 3 of the 4 synthetic tests.
- **Shuffled-time check, Jan 2026 P50 MAE:** targets shuffled across time give 4,714 MW, against 1,308 MW for the real model and 1,532 MW for the current method. The skill disappears when the time link is broken, as it should.

### Training time

- 103 s for the 11 development retrains × 6 quantile models.
- 9.6 s for the October model (6 quantiles, 15,311 rows).
- Measured on a 10-core Apple-silicon laptop.

### Data now used

October 2026 (decisions 1–22 Oct) is used by this confirmation and is no longer a holdout (`docs/data-usage.md`). Any later trial of a quantile model, for example with a calibrated range, needs a new pre-registered rule and data from November 2026 onwards.
