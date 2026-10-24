# Validation and sensitivity

The app is scoped to January 2026 decisions. This page checks whether the method holds up on months it was never looked at, and how much each setting matters. It runs the app's own `analysis.py` unchanged; nothing here changes an app default.

- **Data:** decisions made Nov 2025 – Mar 2026 (delivery 2 Nov 2025 – 1 Apr 2026), each month with a full 16-day warm-up, so every one of the 151 delivery days has 168 history hours and 168 band residuals. March includes the 29 Mar clock change (743 hours).
- **Month** = month the buy decision was made, as in the app. The January row reproduces the app's headline numbers exactly.
- **Reproduce:** `python backend/scripts/fetch_data.py --first-delivery 2025-11-02 --last-delivery 2026-04-01 --out-dir analysis/data` then `python analysis/validate.py`.
- All figures are MW; error = forecast − actual (+ = forecast too high). Coverage = share of hours whose actual fell inside the P10–P90 band (target 80%).

## 1. Does the correction work outside January? (09:00 cutoff, app defaults)

| month | hours | raw MAE | adj MAE | MAE cut | raw bias | adj bias | bias removed | days beat | coverage |
|---|---|---|---|---|---|---|---|---|---|
| 2025-11 | 720 | 1,857 | 1,667 | 10% | +1,006 | +42 | 96% | 18/30 | 69% |
| 2025-12 | 744 | 2,082 | 1,609 | 23% | +1,486 | +45 | 97% | 19/31 | 71% |
| 2026-01 | 744 | 2,022 | 1,383 | 32% | +1,746 | +320 | 82% | 22/31 | 69% |
| 2026-02 | 672 | 1,675 | 1,210 | 28% | +1,312 | -32 | 102% | 20/28 | 64% |
| 2026-03 | 743 | 2,114 | 977 | 54% | +2,007 | +57 | 97% | 25/31 | 73% |

Yes. The raw forecast is +1.0 to +2.0 GW too high in every month, and the correction removes 82–102% of the bias, cuts MAE by 10–54% and beats raw on 60–81% of days. January is middle of the pack, not a flattering pick. November is the weakest month (MAE −10%, 18 of 30 days).

## 2. Ratio window: how many days of history for the scaling ratio?

| month | 3d adj MAE | 7d adj MAE | 14d adj MAE | 3d adj bias | 7d adj bias | 14d adj bias | 3d days beat | 7d days beat | 14d days beat |
|---|---|---|---|---|---|---|---|---|---|
| 2025-11 | 1,733 | 1,667 | 1,644 | -1 | +42 | -104 | 16/30 | 18/30 | 16/30 |
| 2025-12 | 1,647 | 1,609 | 1,629 | +224 | +45 | +18 | 21/31 | 19/31 | 21/31 |
| 2026-01 | 1,513 | 1,383 | 1,312 | +91 | +320 | +405 | 22/31 | 22/31 | 25/31 |
| 2026-02 | 1,144 | 1,210 | 1,156 | +23 | -32 | -78 | 20/28 | 20/28 | 21/28 |
| 2026-03 | 1,038 | 977 | 934 | +63 | +57 | +152 | 24/31 | 25/31 | 25/31 |

No setting wins everywhere. Lowest MAE: 14 days in November, January and March, 7 days in December, 3 days in February. Within a month the three windows are 40–200 MW apart. The app keeps 7 days.

## 3. Band: 7 vs 14 days of residuals (ratio fixed at 7 days)

| month | 7d coverage | 14d coverage | 7d width | 14d width |
|---|---|---|---|---|
| 2025-11 | 69% | 74% | 4,803 | 4,912 |
| 2025-12 | 71% | 78% | 4,634 | 5,146 |
| 2026-01 | 69% | 79% | 4,838 | 5,210 |
| 2026-02 | 64% | 69% | 3,506 | 3,571 |
| 2026-03 | 73% | 77% | 3,192 | 3,164 |

14 days of residuals raises coverage in **every** month (by 4–10 points) for a band between 1% narrower and 11% wider, but it still falls short of 80% everywhere (69–79%). The app keeps 7 days; see the conclusion.

## 4. Decision cutoff: what does waiting for a later run buy?

| month | 06:00 raw MAE | 09:00 raw MAE | 09:30 raw MAE | 06:00 adj MAE | 09:00 adj MAE | 09:30 adj MAE | 06:00 coverage | 09:00 coverage | 09:30 coverage |
|---|---|---|---|---|---|---|---|---|---|
| 2025-11 | 1,913 | 1,857 | 1,853 | 1,703 | 1,667 | 1,695 | 67% | 69% | 68% |
| 2025-12 | 2,068 | 2,082 | 2,030 | 1,618 | 1,609 | 1,561 | 69% | 71% | 71% |
| 2026-01 | 2,003 | 2,022 | 1,996 | 1,483 | 1,383 | 1,379 | 68% | 69% | 69% |
| 2026-02 | 1,702 | 1,675 | 1,675 | 1,279 | 1,210 | 1,172 | 66% | 64% | 61% |
| 2026-03 | 2,107 | 2,114 | 2,100 | 1,037 | 977 | 957 | 72% | 73% | 75% |

Very little. Moving from 06:00 to 09:00 helps the adjusted forecast in every month (up to 100 MW). Waiting until 09:30 helps further in 4 of 5 months, by at most about 50 MW, and makes November worse. A 09:30 decision is also after the EPEX auction closes (~09:20), so it only suits N2EX (~09:50).

## 5. Is scaling better than a simpler fix?

| month | ratio adj MAE | additive adj MAE | ratio adj bias | additive adj bias | ratio days beat | additive days beat |
|---|---|---|---|---|---|---|
| 2025-11 | 1,667 | 1,778 | +42 | -114 | 18/30 | 18/30 |
| 2025-12 | 1,609 | 1,813 | +45 | -84 | 19/31 | 16/31 |
| 2026-01 | 1,383 | 1,556 | +320 | +216 | 22/31 | 21/31 |
| 2026-02 | 1,210 | 1,277 | -32 | -74 | 20/28 | 19/28 |
| 2026-03 | 977 | 1,381 | +57 | +115 | 25/31 | 24/31 |

Yes. Scaling by the ratio beats subtracting last week's mean error on MAE in every month, by 67–404 MW. That fits the finding that the gap grows with wind level, so it is closer to proportional than constant.

## Conclusion

The multiplicative correction generalises. In every month from November to March it removes most of the bias and beats both the raw forecast and the additive baseline on MAE, so it is not a January artefact. Where it fails is uncertainty: the band holds the actual in only 64–73% of hours against an 80% target, and is worst in February. Its gains are also uneven: November's MAE improves by only 10%, and in January the actual fell outside the band in every hour on four days when the actual/forecast ratio dropped well below the trailing week's. Widening the residual window to 14 days improves coverage in every month but still never reaches 80%. These five months were all used to see that, so a calibrated band should be fixed in advance and confirmed on months not used here before it changes the app.

## Addendum (24 Oct 2026): the 14-day band on Apr – Sep 2026

This page never set a rule for the 14-day band. The conclusion above only said one should be fixed in advance. So no rule was applied, and none is invented here: Apr–Sep 2026 had already been seen in `docs/uncertainty.md`, so a rule written now would not be a real test. The numbers below are a description, not a confirmation. The data is the same as in `docs/uncertainty.md`, with nothing before 1 Nov 2025 and the ratio fixed at 7 days.

| decision month | 7d coverage | 14d coverage | 7d width (MW) | 14d width (MW) | 7d P10/P90 pinball | 14d P10/P90 pinball |
|---|---|---|---|---|---|---|
| 2026-04 | 73% | 81% | 3,529 | 3,880 | 272 | 259 |
| 2026-05 | 68% | 74% | 2,898 | 3,012 | 244 | 226 |
| 2026-06 | 78% | 78% | 3,184 | 3,279 | 253 | 243 |
| 2026-07 | 75% | 77% | 2,673 | 2,624 | 253 | 252 |
| 2026-08 | 74% | 77% | 2,716 | 2,943 | 252 | 235 |
| 2026-09 | 63% | 68% | 3,627 | 3,749 | 326 | 312 |

The 14-day residual window again raises coverage, in 5 of 6 months with June tied, and lowers P10/P90 pinball loss in all 6. Coverage reaches 75–85% in 4 of 6 months. That makes it the most promising band change seen so far. It is not adopted: it has to be pre-registered and confirmed on data from November 2026 onwards (see `docs/data-usage.md`).

## Skill against naive references (added 24 Oct 2026)

Standard forecast evaluation reports skill against a naive reference (Messner et al. 2020; IEA Wind Recommended Practice). Skill = 1 − MAE of the method ÷ MAE of the reference, so +30% means 30% lower MAE than the reference and 0 means no better.

- **References:** (a) the raw decision forecast; (b) **persistence**, the last FUELHH actual known at the cutoff (its half-hour ended by 09:20 UK on D−1), held flat for the whole delivery day.
- **Hours:** every hour with an actual and an adjusted forecast, as in the app's raw-vs-adjusted comparison. Cutoff 09:20 UK. Nov 2025 – Sep 2026, nothing before 1 Nov 2025 (so 2 of November's 30 delivery days have too little history to adjust). The January row reproduces the app (raw 2,022 MW, adjusted 1,383 MW, 744 hours).
- **Intervals:** 95% percentile intervals from a block bootstrap that resamples whole delivery days (10,000 resamples, seed 0), because errors within a day are strongly correlated. Settings fixed before the run.
- **Reproduce:** `python analysis/skill.py`.

| decision month | days | hours | raw MAE | adj MAE | persistence MAE | raw vs persistence | adjusted vs persistence | adjusted vs raw |
|---|---|---|---|---|---|---|---|---|
| 2025-11 | 28 | 672 | 1,714 | 1,646 | 3,413 | +50% [+33%, +62%] | +52% [+35%, +63%] | +4% [-18%, +21%] |
| 2025-12 | 31 | 744 | 2,082 | 1,609 | 3,604 | +42% [+21%, +58%] | +55% [+38%, +68%] | +23% [+4%, +37%] |
| **2026-01 (app)** | 31 | 744 | 2,022 | 1,383 | 4,097 | +51% [+31%, +64%] | +66% [+53%, +75%] | +32% [+21%, +41%] |
| 2026-02 | 28 | 672 | 1,675 | 1,210 | 4,071 | +59% [+48%, +67%] | +70% [+61%, +77%] | +28% [+13%, +40%] |
| 2026-03 | 31 | 743 | 2,114 | 977 | 4,452 | +53% [+33%, +65%] | +78% [+69%, +84%] | +54% [+42%, +63%] |
| 2026-04 | 30 | 720 | 1,908 | 1,120 | 4,431 | +57% [+43%, +68%] | +75% [+67%, +80%] | +41% [+23%, +54%] |
| 2026-05 | 31 | 744 | 1,190 | 949 | 2,734 | +56% [+36%, +69%] | +65% [+50%, +75%] | +20% [+3%, +33%] |
| 2026-06 | 30 | 720 | 1,482 | 1,022 | 3,126 | +53% [+37%, +64%] | +67% [+60%, +73%] | +31% [+18%, +41%] |
| 2026-07 | 31 | 744 | 1,118 | 866 | 2,951 | +62% [+51%, +70%] | +71% [+57%, +80%] | +22% [+2%, +40%] |
| 2026-08 | 31 | 744 | 1,029 | 882 | 3,273 | +69% [+58%, +76%] | +73% [+64%, +79%] | +14% [+2%, +24%] |
| 2026-09 | 30 | 720 | 2,306 | 1,384 | 4,559 | +49% [+29%, +63%] | +70% [+60%, +76%] | +40% [+28%, +48%] |
| **all 11 months** | 332 | 7967 | 1,693 | 1,182 | 3,697 | +54% [+50%, +58%] | +68% [+65%, +71%] | +30% [+26%, +34%] |

**What it shows**

- **Both forecasts beat persistence by a wide margin in every month:** the raw forecast by 42–69%, the adjusted forecast by 52–78%. Every interval is well above zero. At 16–40 hours ahead, "tomorrow looks like now" is a weak reference, so this mostly confirms that WINDFOR carries real weather information despite its level gap.
- **The correction beats the raw forecast in 10 of 11 months with an interval above zero** (pooled +30%, 95% CI +26% to +34%). Three of those ten only just clear zero (lower bounds +3% in May, +2% in July and August), so "above zero in 10 of 11" is the honest summary, not "clearly significant everywhere". The exception is November 2025 (+4%, CI −18% to +21%), the month the correction also helped least in `docs/validation.md` §1. This is the correlation-aware version of "adjusted beat raw on 22 of 31 days": resampling whole days, the January gain is +32% (CI +21% to +41%).
- These are measured on months that were already used to develop and describe the method, so they are a description, not a fresh test. A climatology reference (the average actual for each hour of day) was not computed.
