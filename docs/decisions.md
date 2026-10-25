# Decisions

Architecture and method decisions, newest first. Each records the context, the decision, the evidence, and the consequences.

## ADR-001: Add the CQR model as a selectable challenger

**Date:** 25 Oct 2026. **Status:** accepted. **Decided by:** Aditya (project owner).

### Context

The app's method is simple and transparent:
- a 7-day outturn-to-forecast ratio scales the NESO forecast (the bias-corrected forecast);
- the 80% range and the planning volumes come from the trailing week's out-of-sample residuals.

It works, but its tails under-cover. In January 2026 its 80% range held the outturn in 69% of hours, and its P90 planning volume was met in 84% of hours over Nov 2025 – Sep 2026 against a 90% target (`plan-backtest.md`).

A LightGBM quantile model using the same decision-time information was more accurate in the middle, but its range was far too narrow (`ml-challenger.md`: not adoption-worthy, 49% coverage on October 2026). Conformalized quantile regression (CQR) recalibrates that range from the model's own recent out-of-sample errors (28-day window).

### Decision

Add **LightGBM + CQR** to the app as a **selectable model** ("ML"), next to the existing method ("Simple").
- Simple stays the default.
- Simple's numbers and the README headline figures do not change.
- ML predictions are precomputed offline with the frozen recipe and shipped as a checked CSV. There is no machine learning at runtime, and LightGBM stays out of the backend's requirements.

### Evidence

All on the same hours as the current method, with day-block bootstrap 95% intervals (10,000 resamples, seed 0).

| | Development, Nov 2025 – Sep 2026 (`cqr.md`) | 2024, unseen year (`cqr-2024.md`) |
|---|---|---|
| Hours | 7,775 | 8,784 |
| 80% range coverage, ML (current) | 80% [78%, 83%] (71%) | 80.0% [78%, 82%] (73%) |
| Months with coverage in 75–85% | 8 of 11 | 10 of 12 |
| Pinball loss, ML − current | −50 MW [−79, −24] | −55 MW [−81, −31] |
| MAE, ML − current | −100 MW [−182, −22] | −101 MW [−169, −38] |
| P50 / P70 / P80 / P90 / P95 hit rate, ML | 49 / 69 / 79 / 89 / 94% | 48 / 68 / 79 / 89 / 94% |

**Pre-registered verdicts:**
- `cqr.md`: "promising, unconfirmed (needs Nov 2026+ data)".
- `cqr-2024.md`: "confirmed out-of-period".

**Where ML is worse:**
- Its pinball loss was higher than the current method's in 3 of 12 months of 2024 (May, August, December).
- Monthly coverage still ranges from 73% to 87%.

### Deviation from the data-usage rule

`data-usage.md` says a change to the correction or the band must be pre-registered and confirmed on data from November 2026 onwards. **This decision does not meet that rule, and says so.**
- The rule was written when no unseen period was thought to exist. The 2023–2024 data had not been fetched, and 2024 has since served as an unseen, pre-registered confirmation.
- Adding ML is a documented owner decision based on that evidence. It is **not** a new confirmation, and no further data was used to make it.
- It is limited: ML is optional, and Simple stays the default and the basis of every headline number.

### Consequences

- **Users can switch** between Simple and ML (`?model=ml`). The Accuracy view compares the two for January.
- **ML covers the 09:00 / 09:20 decision times only,** the cutoff it was precomputed and tested at (no WINDFOR run falls between them). Other decision times show Simple.
- **A second method needs maintenance.** `make ml` regenerates the predictions from the analysis data (gitignored, sha256 manifests). A test checks the regenerated file matches the shipped one.
- **Making ML the default** would need the trial the data-usage rule asks for: a pre-registered run on Nov 2026+ decision months.
