# Conformalized quantile regression on the LightGBM challenger (exploratory)

Analysis only. The app does not change, whatever the result.

**Status: rule committed on 25 Oct 2026, before any CQR computation.** The rule section is not edited after this commit. Results are added below the line.

**Why exploratory.** The LightGBM challenger (`docs/ml-challenger.md`) was accurate in the middle but its 80% range was far too narrow: 55% coverage in development, 49% on October 2026. CQR is the standard fix for that. But every month used here has already been seen, including October 2026, which was used for the challenger's confirmation. So the best this study can conclude is "promising, unconfirmed". It cannot confirm anything, and it consumes no new data.

## Pre-registered rule

### Base model

The LightGBM challenger exactly as pre-registered in `docs/ml-challenger.md` (features, hyperparameters, expanding window from Jan 2025, retrained monthly). Its out-of-sample prediction for any hour is the one from the model of that hour's decision month, which was trained only on deliveries before that month began. Quantiles are sorted and floored at 0 as there.

### Conformal adjustment

**Calibration set for decision time t:**
- the challenger's out-of-sample predictions for every hour whose outturn was known at t (startTime + 30 min ≤ t) within the previous **28 days** (startTime + 30 min > t − 28 days);
- the window length is fixed here and not tuned;
- a decision day with fewer than 168 calibration hours gets no adjustment (its raw challenger quantiles are used) and is counted.

The conformal quantile of a score S over n calibration hours is its ⌈(1 − a)(n + 1)⌉-th smallest value (the ⌈(1 − a)(n + 1)⌉/n empirical quantile).

- **80% range (two-sided CQR):**
  - score E = max(q₀.₁₀ − y, y − q₀.₉₀);
  - Q = conformal quantile of E at a = 0.20;
  - range = [q₀.₁₀ − Q, q₀.₉₀ + Q], lower edge floored at 0.
- **Exceedance levels P50, P70, P80, P90, P95 (one-sided):** for level C with challenger quantile q_τ (τ = 1 − C/100):
  - score S = q_τ − y;
  - Q = conformal quantile of S at a = 1 − C/100, i.e. the ⌈(C/100)(n + 1)⌉-th smallest;
  - adjusted planning volume = max(q_τ − Q, 0). This targets P(outturn ≥ planning volume) ≥ C%.
- **Upper quantile for the pinball loss:**
  - score S = y − q₀.₉₀;
  - Q at the ⌈0.9(n + 1)⌉-th smallest;
  - adjusted q₀.₉₀ = q₀.₉₀ + Q.

  This is used only so that the pinball loss has an α = 0.90 term. The 80% range itself uses the two-sided interval above.

### Methods compared

On exactly the same hours:
1. **Current method**: the app's, unchanged, as defined in `docs/ml-challenger.md`.
2. **LightGBM raw**: the challenger's quantiles.
3. **LightGBM + CQR**: the adjustments above.

For each method:
- **80% range** = its [P10, P90]. For the current method and LightGBM raw that is [q₀.₁₀, q₀.₉₀]. For CQR it is the two-sided interval.
- **Pinball loss** is the mean over α = 0.10, 0.50, 0.90, using:
  - q₀.₁₀ = P90 planning volume;
  - q₀.₅₀ = P50 planning volume;
  - q₀.₉₀ = the upper quantile.
- **MAE** is that of q₀.₅₀.

### Evaluation

- **Development:** decision months Nov 2025 – Sep 2026, on the 7,775 hours scored in `docs/plan-backtest.md` and `docs/ml-challenger.md`.
- **October 2026** (delivery 2–23 Oct, 528 hours) is reported separately, labelled **"already seen in the LightGBM study, not a clean holdout"**. It plays no part in the verdict.

**Reported for all three methods, per month and pooled:**
- 80% range coverage;
- mean width (MW);
- pinball loss (MW);
- MAE (MW);
- P50–P95 hit rates against target;
- the cost backtest at £100 short / £30 long per MWh (as in `docs/cost-backtest.md`).

**Uncertainty:** day-block bootstrap (10,000 resamples of delivery days, seed 0, 95% percentile intervals), pooled, for:
- CQR − current, pinball loss;
- CQR − current, MAE;
- CQR coverage.

### Verdict wording, fixed in advance

- **"promising, unconfirmed (needs Nov 2026+ data)"** if both hold:
  1. CQR's 80% range coverage is within 75–85% in **at least 8 of the 11** development months;
  2. CQR's pooled development pinball loss is **lower** than the current method's (point estimate).
- **"not promising"** otherwise.

### Leakage guard

A test asserts that no calibration row's outturn ends later than the decision time it serves. It also asserts that every calibration prediction came from a model trained only on deliveries before that row's own decision month.

---

## Results

Run on 25 Oct 2026 with `python analysis/cqr.py` (about 2.5 minutes). Leakage tests are in `analysis/tests/test_cqr.py`. The script also asserts, for every calibration window, that each outturn was known at the decision time and that each prediction came from a model trained before its own decision month.

- Every development and October day had a full 28-day window of 672 calibration hours, so no day went unadjusted.
- The LightGBM-raw rows reproduce `docs/ml-challenger.md` exactly (development MAE 1,183 MW, coverage 55%; October MAE 1,383 MW, coverage 49%).

### Verdict: promising, unconfirmed (needs Nov 2026+ data)

- **Condition 1, coverage within 75–85% in at least 8 of 11 development months:** met, **8 of 11**, the bare minimum.
  - Outside the band: December (87.1%), May (86.8%) and September (72.8%).
  - Two of the eight are on the edge: April is exactly 85.0% (612 of 720 hours; the bound is inclusive) and June is 75.3%. One more April hour inside the range would have failed the rule.
- **Condition 2, pooled pinball loss below the current method's:** met, 369 vs 420 MW.

So the rule says "promising, unconfirmed". The margin on coverage is thin. The pinball and MAE gains are clearer: the day-block intervals below exclude zero.

### Development, Nov 2025 – Sep 2026 (decides the verdict)

| decision month | hours | coverage current | coverage LightGBM raw | coverage LightGBM + CQR | pinball current | pinball LightGBM raw | pinball LightGBM + CQR |
|---|---|---|---|---|---|---|---|
| 2025-11 | 480 | 70% | 38% | 80% | 559 | 606 | 436 |
| 2025-12 | 744 | 71% | 53% | 87% | 579 | 443 | 419 |
| 2026-01 | 744 | 69% | 54% | 77% | 541 | 439 | 424 |
| 2026-02 | 672 | 64% | 57% | 78% | 427 | 417 | 383 |
| 2026-03 | 743 | 73% | 48% | 80% | 368 | 425 | 387 |
| 2026-04 | 720 | 73% | 54% | 85% | 385 | 379 | 367 |
| 2026-05 | 744 | 68% | 62% | 87% | 342 | 299 | 288 |
| 2026-06 | 720 | 78% | 59% | 75% | 341 | 358 | 339 |
| 2026-07 | 744 | 75% | 66% | 81% | 330 | 319 | 328 |
| 2026-08 | 744 | 74% | 59% | 79% | 325 | 304 | 299 |
| 2026-09 | 720 | 63% | 52% | 73% | 468 | 457 | 419 |
| all | 7775 | 71% | 55% | 80% | 420 | 397 | 369 |

Pooled, all metrics (MW unless stated):

| method | coverage | mean width | pinball | MAE | P50 hit (target 50%) | P70 hit (target 70%) | P80 hit (target 80%) | P90 hit (target 90%) | P95 hit (target 95%) |
|---|---|---|---|---|---|---|---|---|---|
| current | 71% | 3,557 | 420 | 1,272 | 50% | 67% | 76% | 84% | 89% |
| LightGBM raw | 55% | 2,290 | 397 | 1,183 | 53% | 65% | 72% | 81% | 86% |
| LightGBM + CQR | 80% | 3,713 | 369 | 1,172 | 49% | 69% | 79% | 89% | 94% |

Cost backtest, short £100 / long £30 per MWh (£m, GB-wide volume):

| method | P50 | P70 | P80 | P90 | P95 |
|---|---|---|---|---|---|
| current | 649.0 | 531.0 | 524.5 | 562.1 | 612.9 |
| LightGBM raw | 575.9 | 487.0 | 459.7 | 457.3 | 480.5 |
| LightGBM + CQR | 621.8 | 479.0 | 462.2 | 503.9 | 578.3 |

Day-block bootstrap, 95%: CQR − current pinball -50 MW [-79, -24]; CQR − current MAE -100 MW [-182, -22]; CQR coverage 80% [78%, 83%].

### October 2026: already seen in the LightGBM study, not a clean holdout

Pooled, all metrics (MW unless stated):

| method | coverage | mean width | pinball | MAE | P50 hit (target 50%) | P70 hit (target 70%) | P80 hit (target 80%) | P90 hit (target 90%) | P95 hit (target 95%) |
|---|---|---|---|---|---|---|---|---|---|
| current | 72% | 4,780 | 538 | 1,533 | 58% | 74% | 83% | 89% | 92% |
| LightGBM raw | 49% | 2,597 | 476 | 1,383 | 53% | 64% | 73% | 80% | 84% |
| LightGBM + CQR | 83% | 4,632 | 450 | 1,457 | 57% | 79% | 86% | 94% | 96% |

Cost backtest, short £100 / long £30 per MWh (£m, GB-wide volume):

| method | P50 | P70 | P80 | P90 | P95 |
|---|---|---|---|---|---|
| current | 45.0 | 38.8 | 41.1 | 51.4 | 56.5 |
| LightGBM raw | 44.7 | 39.7 | 38.3 | 38.4 | 39.0 |
| LightGBM + CQR | 43.0 | 38.5 | 41.4 | 47.5 | 55.1 |

Day-block bootstrap, 95%: CQR − current pinball -89 MW [-180, -3]; CQR − current MAE -76 MW [-364, +212]; CQR coverage 83% [73%, 92%].

### What it shows

- **CQR fixes the challenger's main flaw.** The 80% range goes from 55% to 80% coverage pooled (bootstrap 78–83%), at a mean width (3,713 MW) close to the current method's (3,557 MW).
- **It is better than the current method on both scores.** Pooled development pinball loss −50 MW [−79, −24] and MAE −100 MW [−182, −22], with the planning-volume hit rates within 1 point of target at every level.
- **Monthly coverage still swings,** from 73% to 87%. A 28-day window adapts, but not instantly.
- **Costs:**
  - At £100/£30, CQR's P70 and P80 cost less than the current method's (£479m and £462m vs £531m and £525m). Its P90 and P95 also cost less, but more than the raw challenger's, which is the honest price of actually meeting those levels.
  - The raw challenger's low tail costs mean little, because its P90 and P95 are met only 81% and 86% of the time.
  - All £ figures are GB-wide volumes at illustrative costs.
- **October, already seen and not a clean holdout:**
  - coverage 83%, pinball −89 MW [−180, −3];
  - MAE −76 MW, with an interval spanning zero.

  This is consistent with development, but it is not independent evidence.

### Data

No new data was used: Nov 2025 – Sep 2026 and October 2026 had all been seen before (`docs/data-usage.md`). A real test needs a new pre-registered rule and decision months from November 2026 onwards, for example:
- LightGBM + CQR against the current method;
- coverage 75–85% and lower pinball loss;
- on at least three months.
