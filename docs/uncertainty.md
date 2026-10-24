# Uncertainty band: evaluation and candidates

## Decision rule (written and committed before any band was evaluated)

The rule below was committed to git before any of the numbers on this page were computed, including the current band's. It is applied exactly as written; the commit history shows it was not edited after the results were known.

### What "calibrated but wide" vs "sharp but wrong" means for a trader

A *calibrated* band contains the actual as often as it claims to: an 80% band misses about 1 hour in 5, P10 is undershot about 10% of the time, and so on. A *sharp* band is narrow. A band that is calibrated but wide is honest but not very useful: the trader can trust that the worst case really is a plausible worst case, but it covers so much that the decision barely changes, and hedging against all of it costs money. A band that is sharp but wrong is dangerous. It looks precise, so the trader sizes positions to it, but it misses far more often than stated, and those misses arrive as unhedged imbalance exposure on exactly the days that matter. The goal is the sharpest band that stays calibrated. Pinball loss scores both properties together: it penalises a quantile for being on the wrong side of the actual, weighted by how far off it is, so it can't be gamed by simply widening or narrowing the band.

### Data and scoring

- **Data:** `analysis/data` and `analysis/data-2026-04-09`. Nothing published or timestamped before 1 Nov 2025 is read.
- **Decision forecast and adjusted forecast:** the app's own logic (`analysis.py`), with a 09:00 UK cutoff, a 7-day ratio and actuals counted as known once startTime + 30 min ≤ cutoff.
- **Days scored:** only delivery days whose band rests on a full 168-hour window of out-of-sample residuals, so the first ~2 weeks of November warm up and are not scored. A month is the month of the decision (D−1), as in `docs/validation.md`.
- **Quantile levels:** q ∈ {0.10, 0.25, 0.50, 0.75, 0.90}. Each band produces a predicted value at every q.
- **Metrics per month:**
  - coverage of the P10–P90 interval (share of hours with P10 ≤ actual ≤ P90);
  - reliability: the share of hours with actual ≤ predicted q, for each q;
  - pinball loss averaged over the five q and all hours;
  - mean P10–P90 width.

### Bands

- **B0, the current band.** adjusted + the q-quantile of out-of-sample residuals (actual − adjusted) over the trailing 7 days of known hours. This is the app's band, extended from P10/P90 to all five q.
- **C1, rolling (adaptive) conformal.** Same as B0, but the quantile level used for each q is adjusted online, as in adaptive conformal inference.
  - Each q starts at a_q = q.
  - Before each delivery day D, a_q += γ · Σ (q − 1{actual ≤ predicted q}), summed over every hour whose actual became known between the previous delivery day's cutoff and D's cutoff, using the prediction that was made for that hour.
  - a_q is clipped to [0.005, 0.995], and γ = 0.005 per hour is fixed in advance and not tuned.
  - Why: the anatomy found errors arrive in regimes (whole days off), and C1 tracks recent misses.
- **C2, width scaled by forecast level.** adjusted × (1 + q-quantile of relative residuals (actual − adjusted) / adjusted) over the same trailing 7 days.
  - Why: forecast level is the strongest predictor of error size found (Spearman 0.56, anatomy §4), and the plateau makes errors grow at high wind (anatomy §3).
- **C3, C2 plus C1's adaptive levels.** Same update rule and γ as C1.
- **Not tested: width scaled by run-to-run disagreement.** Anatomy §4 found it adds nothing once forecast level is controlled for (Spearman 0.23, 0.05 and −0.15 within forecast-level terciles).

### Selection, using decision months Nov 2025 – Mar 2026

The finalist is the candidate (C1, C2 or C3) with the lowest pinball loss pooled over all scored selection hours. That pooled loss must also be lower than B0's. If no candidate beats B0 on the selection months, nothing goes to the holdout and the app is unchanged.

### Confirmation, using decision months Apr – Sep 2026 (6 months)

Only the finalist is tested. It is **adopted** only if both of these hold:

1. its P10–P90 coverage is within 5 percentage points of 80% (75%–85% inclusive) in **at least 5 of the 6** holdout months; **and**
2. its pinball loss is strictly lower than B0's in **at least 5 of the 6** holdout months.

Otherwise it is rejected, and the app keeps B0. Whatever the outcome, every band's results are reported for every month.

### If adopted

It is implemented in the app test-first, the golden test and README are updated, and the app's January figures are recomputed. The holdout is not used to tune anything.
