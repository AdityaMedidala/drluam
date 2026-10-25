# Wind forecast pilot: findings and recommendation

*For the day-ahead power desk. Pilot on January 2026 decisions, with checks on Nov 2025 – Sep 2026 and 2024. Prepared 25 Oct 2026.*

## The problem

Your desk buys power in the GB day-ahead auctions, which close at 09:20 UK on the day before delivery (EPEX). At that moment the latest national wind forecast (NESO's WINDFOR, published by Elexon) is your best view of how much wind will offset demand. If the forecast is too high, you buy too little and cover the gap later at short notice. If it is too low, you buy too much. The pilot asked two questions. What did the desk actually know at 09:20? How far can it be trusted?

## Three findings

### 1. The forecast you see at 09:20 runs high, consistently

- **In January 2026 it was too high in 85% of hours, by 1,746 MW on average.** The mean absolute error was 2,022 MW.
- **The pattern holds from Nov 2025 to Sep 2026,** with an average over-forecast of 1,351 MW.
- **It is there at every lead time,** about 1.5–2 GW, even for hours that had already happened when the forecast was published (+1.7 GW). So it is not just weather uncertainty.

**Likely cause: curtailment.**
- In January, wind farms were turned down through accepted balancing-mechanism bids by **1,524 MW** on average. That accounts for about **87%** of the average gap.
- Adding those volumes back cuts the bias from +1,746 MW to **+221 MW**.

**Caveats:**
- This is an association, not proof.
- It uses data outside the pilot's scope (Elexon bid volumes).
- Curtailment is known only after the fact, so it cannot simply be added at decision time.
- One bad day, 28 Jan, is not explained by it.

*Sources: README (key findings), docs/error-anatomy.md, docs/curtailment-check.md.*

### 2. A simple correction removes most of the bias and gives planning volumes you can check

**The correction.** Scaling the forecast by the previous week's outturn-to-forecast ratio:
- cut January's error from **2,022 to 1,383 MW (−32%)**;
- cut the bias from **+1,746 to +320 MW**, removing 82% of it;
- did better on 22 of 31 days.

In every month from Nov 2025 to Mar 2026 it removed 82–102% of the bias.

**Planning volumes.** The app turns the corrected forecast into a planning volume at an exceedance level you choose. Backtested on 7,775 hours from Nov 2025 to Sep 2026, outturn met:
- the **P90** volume in **84%** of hours (target 90%);
- the **P95** volume in **89%** (target 95%).

The tails under-cover, so the app shows the measured hit rates, not the targets.

*Sources: README, docs/validation.md, docs/plan-backtest.md.*

### 3. Choose the level by what being short or long costs you (illustrative)

**The rule.** If being short costs £100/MWh and being long £30/MWh, the cost-minimising level is P77. The nearest level the app offers is P80.

**The backtest.**
- Over Nov 2025 – Sep 2026, P80 was also the lowest-cost level in the backtest.
- It would have cost **£694m less** than planning on the uncorrected forecast, in this backtest at these assumptions.
- The bias correction alone accounts for £608m of that.

**These are GB-wide volumes at assumed prices, not your exposure.**

*Source: docs/cost-backtest.md.*

## Recommendation

**Use the Simple model today:** the bias-corrected forecast and a planning volume at a level set by your costs, P80 at £100/£30.
- It is transparent: one ratio, one week of history, nothing hidden.
- It was checked on 11 months of decisions, Nov 2025 – Sep 2026, not just the pilot month.
- Every figure the app shows is the measured one.

## Phase two

- **ML + CQR.** It is in the app as an optional model and confirmed out-of-period on 2024:
  - its 80% range held the outturn in **80.0%** of hours;
  - it was within 75–85% in 10 of 12 months;
  - its accuracy score (pinball loss) was 55 MW better than Simple's [95% interval −81 to −31 MW].

  It becomes the default only after a pre-registered trial on live months from November 2026. *Sources: docs/cqr-2024.md, docs/decisions.md (ADR-001).*
- **A live daily run.** Fetch the forecast at the decision time each day instead of using a fixed snapshot.
- **Forecasting curtailment.** Curtailment explains most of the gap, so predicting it from constraint signals is the most valuable next step.
- **Your own costs.** Replace the illustrative £/MWh with your imbalance prices and portfolio volumes, so the recommended level and the savings are yours.

## Limits

- **The app's numbers are one month** (January 2026). Other months are in the analysis documents.
- **The tails under-cover:** P90 was met in 84% of hours, not 90%.
- **The £ figures are illustrative,** GB-wide and at assumed prices.
- **The curtailment link** is an association and uses data outside the pilot's scope.
- **The app runs on a fixed snapshot** of Elexon data, not a live feed.
