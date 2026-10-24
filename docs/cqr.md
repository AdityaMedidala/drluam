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

_Not yet run._
