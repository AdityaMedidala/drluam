# Method candidates after the vault

The Jan–Oct 2025 vault was used once, on 24 Oct 2026, for the level-aware correction, which failed its pre-registered rule (`docs/correction.md`, `docs/data-usage.md`). Every month from Nov 2025 to Sep 2026 has also been looked at. So no method change can be confirmed on data that exists today, and **nothing on this page is adopted before submission**.

This page records the one candidate worth confirming later, with the rule for that confirmation written now, before any Nov 2026+ data is fetched.

## Candidate: a band built from 14 days of residuals (promising, unconfirmed)

**What changes.** The band (and the planning volumes at each exceedance level, which use the same residuals) would use the out-of-sample residuals from the previous **14** days of hours whose actuals are known at the cutoff, instead of 7. Everything else stays as in the app: the 7-day ratio correction, residual = actual − that day's own adjusted forecast, at least 24 residuals, P10/P90 for the band.

**Evidence so far** (descriptive only, because no rule was set before these months were seen):

| decision month | 7-day coverage | 14-day coverage | 7-day width (MW) | 14-day width (MW) |
|---|---|---|---|---|
| 2025-11 | 69% | 74% | 4,803 | 4,912 |
| 2025-12 | 71% | 78% | 4,634 | 5,146 |
| 2026-01 | 69% | 79% | 4,838 | 5,210 |
| 2026-02 | 64% | 69% | 3,506 | 3,571 |
| 2026-03 | 73% | 77% | 3,192 | 3,164 |
| 2026-04 | 73% | 81% | 3,529 | 3,880 |
| 2026-05 | 68% | 74% | 2,898 | 3,012 |
| 2026-06 | 78% | 78% | 3,184 | 3,279 |
| 2026-07 | 75% | 77% | 2,673 | 2,624 |
| 2026-08 | 74% | 77% | 2,716 | 2,943 |
| 2026-09 | 63% | 68% | 3,627 | 3,749 |

Sources: `docs/validation.md` §3 (Nov–Mar) and its addendum (Apr–Sep), which also shows P10/P90 pinball loss lower with 14 days in all 6 Apr–Sep months.

- Coverage rises in 10 of 11 months (June tied), by 2–10 points, for a band between 2% narrower and 11% wider.
- It still falls short of 80% in 10 of 11 months (April reaches 81%).
- Why it should help: hourly errors are correlated within and across days, so 7 days hold only two or three independent weather regimes (Messner et al. 2020; IEA Wind Recommended Practice). A longer window sees more of them. A public submission to the same brief reports 78% coverage with a 14-day band.
- Why it might not: a longer window reacts more slowly when conditions change (for example a run of curtailment), which is exactly when the current band fails (`docs/error-anatomy.md`, worst days).

### Pre-registered confirmation rule (for Nov 2026+ data)

Written and committed before any data from November 2026 onwards is fetched. Applied exactly once, mechanically.

- **Data:** decision months November 2026 – April 2027 (6 months), fetched after this commit with `backend/scripts/fetch_data.py`. A 14-day residual window whose days each use a 7-day ratio needs at least 22 days of history before the first delivery day, so the script's 16-day history must be widened first. Cutoff 09:20 UK. Only hours where both bands use a full window are scored (168 residuals for 7 days, 336 for 14).
- **Metric:** mean pinball loss over the P10 and P90 quantiles (lower is better), with P10–P90 coverage and mean width reported alongside.
- **Uncertainty:** a block bootstrap by delivery day (10,000 resamples, seed 0) of the pooled difference in pinball loss, 14-day minus 7-day.
- **Adopt the 14-day band only if all three hold:**
  1. pinball loss is lower in **at least 5 of the 6** months;
  2. the 95% bootstrap interval of the pooled pinball difference lies entirely **below zero**;
  3. coverage is within 75–85% in **at least 4 of the 6** months, and is not lower than the 7-day band's in more than 1 month.
- **Otherwise** the app keeps the 7-day band, and the result is written up here whatever it is.

If adopted, the change goes into the app test-first, with the golden test, README, UI method notes and plan hit rates updated in the same change.

## Considered and not pursued

- **Ratio per forecast-level band** (separate ratios for <5, 5–10, 10–15, >15 GW). Already tested against a pre-registered rule and **failed on the vault**: MAE lower in 3 of 10 months (needed 8), |bias| worse in 9 of 10 (`docs/correction.md`).
- **Affine correction `a + b·forecast`** with exponential weighting. It targets the same level effect as the failed per-band ratio, with fewer parameters. Not pursued: it could not be confirmed before submission, and a second attempt at the same target on already-seen months would add little evidence.
- **Residual quantiles conditional on forecast level.** The literature's version needs months of history per level bin (hundreds of hours each); 28 days split four ways leaves too few high-wind hours, which are the ones that matter most. Not pursued until more history is available.
