# Research log

Every study beyond the app's core numbers, in order. "Rule first" means the decision rule was committed before the data it was judged on was computed (or, for new data, fetched). Data usage per period is in `data-usage.md`.

| date | study | rule first? | data judged on | verdict | doc |
|---|---|---|---|---|---|
| 24 Oct 2026 | Bias correction validated on other months | no (descriptive) | Nov 2025 – Mar 2026 | 82–102% of the bias removed every month; descriptive only | `validation.md` |
| 24 Oct 2026 | Anatomy of the decision-forecast error | no (descriptive) | Nov 2025 – Sep 2026 | descriptive | `error-anatomy.md` |
| 24 Oct 2026 | New uncertainty bands (three candidates) | yes (`c9476b3`) | Nov 2025 – Sep 2026 | none passes the rule | `uncertainty.md` |
| 24 Oct 2026 | 14-day residual window for the band | no rule at the time; rule for Nov 2026+ committed later (`7743fce`) | Nov 2025 – Sep 2026 | promising, unconfirmed (descriptive) | `validation.md`, `method-candidates.md` |
| 24 Oct 2026 | Level-aware correction | yes (`46bf792`) | the Jan – Oct 2025 vault, once | **failed** | `correction.md` |
| 24 Oct 2026 | Planning-volume hit rates | no (description of the app's method) | Nov 2025 – Sep 2026 | P90 met 84% of hours, P95 89% | `plan-backtest.md` |
| 24 Oct 2026 | Skill against raw and persistence | no (descriptive) | Nov 2025 – Sep 2026 | descriptive, day-block intervals | `validation.md` |
| 24 Oct 2026 | Curtailment check (outside the brief) | no (descriptive) | January 2026 | accepted wind bids account for about 87% of the average gap | `curtailment-check.md` |
| 24 Oct 2026 | Cost-aware exceedance level (illustrative) | no (decision aid) | Nov 2025 – Sep 2026 | at £100/£30, P80 lowest-cost pooled | `cost-backtest.md` |
| 24 Oct 2026 | LightGBM quantile challenger | yes (`80d3858`) | October 2026, once | **not adoption-worthy** (coverage 49%) | `ml-challenger.md` |
| 25 Oct 2026 | Conformalized quantile regression (CQR) on the challenger | yes (`6608a98`), exploratory | Nov 2025 – Sep 2026 (seen before) | promising, unconfirmed (8 of 11 months in band) | `cqr.md` |
| 25 Oct 2026 | CQR out-of-period confirmation | yes (`a6d8e6e`), before fetching | 2024, once (trained from 2023) | **confirmed out-of-period** (coverage 80.0%, pinball −55 MW [−81, −31]) | `cqr-2024.md` |

**Where this leaves the app.** The app still uses the 7-day ratio correction and the 7-day residual band. LightGBM + CQR is the strongest candidate so far: confirmed on one unseen year, and promising on the development months. The project's rule is that a method change needs a pre-registered trial on Nov 2026+ data first.
