# Cost backtest: which exceedance level would have cost least

The Decision view has a cost-aware exceedance level. The desk enters two illustrative costs, in £ per MWh:

- **short**: outturn came in below the planning volume, so the gap is bought late.
- **long**: outturn came in above it, so the surplus is sold back.

**Recommended level.** The level that minimises expected cost is the one exceeded with probability short ÷ (short + long). This is the newsvendor critical ratio (Arrow, Harris and Marschak 1951), applied to wind trading by Pinson, Chevallier and Kariniotakis (2007). The app shows the exact value, for example P77, and the nearest offered level (P50, P70, P80, P90 or P95). Ties go to the higher level, and anything below P50 snaps to P50.

**Backtest.** Hourly cost = short × max(plan − outturn, 0) + long × max(outturn − plan, 0), with hourly MW × 1 h = MWh. It uses the same out-of-sample residuals and the same hourly outturn alignment as the hit rates (`backend/app/analysis.py`: `plan_cost`, `cost_backtest`). Every row is scored on the same hours.

**What this is not.** It is an illustrative decision aid at assumed costs, not a validated method change. Real imbalance prices vary by hour and are correlated with the wind error. A saving here means only "would have cost £X less in this backtest at these assumptions".

- **App (January 2026 decisions, 744 hours):** `/api/cost`, at the default 09:20 cutoff, with the defaults short £100 and long £30.
- **Development months (Nov 2025 – Sep 2026):** `python analysis/cost_backtest.py`. This is the app's logic unchanged, at the same cutoff. Month = decision month (D−1). Only hours whose band uses a full week of residuals are scored. Nothing before 1 Nov 2025 is used, and the Jan–Oct 2025 vault is not touched.

## Pooled, Nov 2025 – Sep 2026, short £100, long £30 (7,775 hours)

| plan on | cost (£m) | vs NESO forecast (£m) |
|---|---|---|
| P50 | 649.0 | −569.6 |
| P70 | 531.0 | −687.6 |
| P80 | 524.5 | −694.2 |
| P90 | 562.1 | −656.6 |
| P95 | 612.9 | −605.7 |
| NESO forecast | 1,218.6 | – |
| bias-corrected forecast | 611.0 | −607.7 |


## Lowest-cost level by month, short £100, long £30

| decision month | hours | lowest-cost level | P80 vs NESO forecast (£m) | lowest-cost level vs P80 (£m) |
|---|---|---|---|---|
| 2025-11 | 480 | P95 | −22.1 | −2.7 |
| 2025-12 | 744 | P80 | −66.2 | 0.0 |
| 2026-01 | 744 | P70 | −67.0 | −4.6 |
| 2026-02 | 672 | P80 | −62.5 | 0.0 |
| 2026-03 | 743 | P80 | −113.1 | 0.0 |
| 2026-04 | 720 | P80 | −85.0 | 0.0 |
| 2026-05 | 744 | P80 | −44.5 | 0.0 |
| 2026-06 | 720 | P80 | −60.5 | 0.0 |
| 2026-07 | 744 | P70 | −37.8 | −0.3 |
| 2026-08 | 744 | P70 | −28.5 | −1.6 |
| 2026-09 | 720 | P80 | −107.0 | 0.0 |


## Theory vs backtest across cost assumptions (pooled)

| short (£/MWh) | long (£/MWh) | critical ratio | recommended | lowest-cost level | recommended vs NESO forecast (£m) | lowest row overall |
|---|---|---|---|---|---|---|
| 30 | 100 | P23 | P50 (snapped) | P50 | +148.3 | NESO forecast |
| 50 | 50 | P50 | P50 | P50 | −162.0 | bias-corrected forecast |
| 60 | 40 | P60 | P70 | P50 | −261.4 | bias-corrected forecast |
| 100 | 30 | P77 | P80 | P80 | −694.2 | P80 |
| 100 | 15 | P87 | P90 | P90 | −857.0 | P90 |
| 200 | 20 | P91 | P90 | P95 | −1,847.5 | P95 |
| 500 | 25 | P95 | P95 | P95 | −5,102.5 | P95 |


## What it shows

- **At the defaults, P80 is recommended and is also the lowest-cost level pooled over the 11 months.** It would have cost £694m less than planning on the NESO forecast over these 7,775 hours, at these assumptions. Most of that is the NESO forecast's over-forecast bias (`docs/error-anatomy.md`). The bias-corrected forecast alone recovers £608m of it.
- **Month by month, the lowest-cost level differs from P80 in 4 of 11 months.** January 2026 (the app's scope) is one of them, at P70, which is £4.6m cheaper than P80 that month. The largest monthly gap is £4.6m. The app shows both the recommended level and the backtest's lowest-cost level.
- **The tail levels under-cover** (P90 met 84% of hours against a 90% target, P95 89% against 95%, `docs/plan-backtest.md`). So when short costs are high, the backtest favours a higher level than the theory. At £200 short and £20 long the critical ratio is P91, the nearest level is P90, but P95 cost least.
- **When long costs dominate, the NESO forecast's over-forecast is the cheaper error.** At £30 short and £100 long the ratio gives P23, which snaps to P50, and the NESO forecast itself has the lowest cost.

## References

- Arrow, K. J., Harris, T. and Marschak, J. (1951). Optimal inventory policy. *Econometrica* 19(3).
- Pinson, P., Chevallier, C. and Kariniotakis, G. N. (2007). Trading wind generation from short-term probabilistic forecasts of wind power. *IEEE Transactions on Power Systems* 22(3).
