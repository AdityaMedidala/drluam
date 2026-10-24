# "Plan on" backtest: how often wind came in at or above the plan

The app's Decision view gives a planning number per hour: the wind the desk can count on with C% confidence. It is the adjusted forecast plus the (1 − C) quantile of the trailing week's out-of-sample residuals, floored at 0 MW (`backend/app/analysis.py`). The 90% plan equals the band's P10 edge.

A plan is honest if the actual comes in at or above it C% of the time. This page measures that. It is a description of the existing method, not a method change, so there is no decision rule to pre-register.

- **App figure (January 2026 decisions, 744 hours):** from `/api/plan`, at the default 09:20 cutoff.
- **Development months (Nov 2025 – Sep 2026):** `python analysis/plan_backtest.py`, the app's logic unchanged, same cutoff. Month = decision month (D−1). Only hours whose band uses a full week of residuals (168) are scored. Nothing before 1 Nov 2025 is used; the Jan–Oct 2025 vault is not touched.

## Hit rate by confidence level

Target: P50 = 50%, P70 = 70%, P80 = 80%, P90 = 90%, P95 = 95%.

| decision month | hours | P50 | P70 | P80 | P90 | P95 |
|---|---|---|---|---|---|---|
| 2025-11 | 480 | 43% | 58% | 68% | 78% | 84% |
| 2025-12 | 744 | 49% | 67% | 76% | 86% | 90% |
| **2026-01 (app scope)** | 744 | 54% | 71% | 79% | 82% | 89% |
| 2026-02 | 672 | 53% | 66% | 72% | 81% | 86% |
| 2026-03 | 743 | 47% | 64% | 73% | 86% | 92% |
| 2026-04 | 720 | 49% | 68% | 75% | 83% | 89% |
| 2026-05 | 744 | 50% | 70% | 77% | 85% | 90% |
| 2026-06 | 720 | 47% | 66% | 76% | 87% | 91% |
| 2026-07 | 744 | 55% | 72% | 81% | 88% | 93% |
| 2026-08 | 744 | 47% | 71% | 80% | 85% | 88% |
| 2026-09 | 720 | 49% | 63% | 71% | 80% | 89% |
| **all 11 months** | 7,775 | 50% | 67% | 76% | 84% | 89% |

November 2025 has 480 hours because the data starts on 1 Nov 2025, so its first days have less than a full week of residuals.

## What it shows

- **P50 is about right** (50% pooled, 43–55% by month).
- **The higher the confidence, the bigger the shortfall.** Pooled, P80 is met 76% of the time, P90 84% and P95 89%. So a "90% plan" behaves like roughly an 84% plan. This is the same under-stated downside seen in `docs/uncertainty.md`: the actual falls below the band's P10 edge in 15–18% of hours, not 10%.
- **January is close to the pooled figures,** slightly better at P50–P80 and slightly worse at P90 (82%).
- **Why:** errors are strongly correlated within a day, so a week of 168 hourly residuals is really about seven day-sized draws. The 95% plan is roughly the 8th-lowest of 168 residuals and can't see a day worse than the worst of the last week. A better-calibrated tail would need a method change, which has to be pre-registered and confirmed on Nov 2026+ data (`docs/data-usage.md`). The 14-day residual window is the most promising candidate (`docs/validation.md`).

## How the app uses this

The Decision view will show the measured January hit rate next to the chosen confidence level ("in January, wind came in at or above this level in Y% of hours, target C%"), so the desk sees the honest figure, not the nominal one.
