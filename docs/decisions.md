# Decisions

Architecture and method decisions. ADR-001 was recorded when it was made. ADR-002 to ADR-006 record earlier decisions afterwards, in short form: context, decision, alternatives and consequence.

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

## ADR-002: Decision time 09:20 UK on D−1, and the latest forecast published by then

- **Context.**
  - The desk buys in the GB day-ahead auctions, which close at about 09:20 (EPEX) and 09:50 (N2EX) UK time on D−1.
  - Accuracy is only meaningful for the forecast the desk could actually see.
- **Decision.**
  - For each hour of delivery day D, use the latest WINDFOR run with publishTime at or before 09:20 UK on D−1.
  - The decision time stays adjustable in the UI.
- **Alternatives.**
  - The newest forecast overall: it overstates accuracy with information the desk never had.
  - 09:00: identical results, since no run is published between 09:00 and 09:20.
  - 09:50 (N2EX): picks up the 09:30 run, and January MAE moves from 2,022 to 1,996 MW (README).
- **Consequence.**
  - Every number is decision-time honest, and tests check that nothing published after the cutoff is used.
  - The precomputed ML model exists only for 09:00 / 09:20 (ADR-001).

## ADR-003: A checked-in snapshot instead of calling Elexon at runtime

- **Context.** January 2026 is fixed history. Elexon's API is public but rate-limited and occasionally slow.
- **Decision.** Serve a CSV snapshot in `backend/data/` with a sha256 manifest. The footer shows the checksum status. `make data` re-fetches it.
- **Alternatives.**
  - Live API calls per request: slower, fails when Elexon does, and results could shift under revisions.
  - A database: unnecessary at about 30k rows.
- **Consequence.**
  - Fast, deterministic and reproducible (`make reproduce` re-fetches and compares the checksums).
  - It is not a live feed; a production version would fetch on a schedule (pilot brief, phase two).

## ADR-004: A 7-day ratio correction with an out-of-sample residual band

- **Context.** The decision-time forecast over-forecasts consistently: January bias +1,746 MW, too high in 85% of hours.
- **Decision.**
  - Scale the forecast by Σoutturn/Σforecast over the previous 7 days, using only outturn known at the decision time.
  - The 80% range and the planning volumes come from that window's out-of-sample residuals.
- **Alternatives.**
  - A fitted or level-aware model: the level-aware correction failed its pre-registered vault test (`correction.md`).
  - A 14-day band: promising, unconfirmed (`method-candidates.md`).
  - LightGBM + CQR: later added as an optional challenger (ADR-001).
- **Consequence.**
  - Explainable and auditable. MAE falls 32% and 82% of the bias is removed in January.
  - The tails under-cover (P90 met in 84% of hours), and the app shows that figure, not the target.

## ADR-005: IBM Carbon for the UI, Recharts for the charts

- **Context.**
  - A trading desk needs a dense, accessible, consistent UI with light and dark themes.
  - The main chart needs a dashed planning line, UK-time axes and keyboard access.
- **Decision.** Use Carbon (`@carbon/react`, with only the component styles used compiled), and keep Recharts for the charts.
- **Alternatives.** The chart spike (commits `934fe00`, `429f688`, `db0d3d0`) rendered the main chart three ways:
  - **Carbon Charts** had no native dashed line, rendered time in the browser's timezone, and truncated long legend labels.
  - **ECharts** had no keyboard focus or navigation.
  - **Recharts** met every requirement at no extra bundle cost. The spike was removed in `4407b03`.
- **Consequence.**
  - One chart library and a Carbon-styled chart frame (table view, full screen, CSV) on every chart.
  - Axe accessibility checks run in the Playwright suite.

## ADR-006: One Vercel project (Services), with the ML model precomputed

- **Context.** The app is a Vite frontend plus a FastAPI backend. ML predictions need LightGBM, which needs a native OpenMP library.
- **Decision.**
  - Deploy both on Vercel Services from one repo: the frontend at `/` and FastAPI at `/api/*` (`vercel.json`).
  - Precompute the ML predictions offline (`make ml`) and ship them as a checksummed CSV. There is no ML at runtime.
- **Alternatives.**
  - Separate frontend and backend hosts: CORS and two deployments.
  - A container host: more operations work for a pilot.
  - Running LightGBM in the function: heavier cold starts and native dependencies, for a result that doesn't change.
- **Consequence.**
  - One URL and one deployment per push, with previews per branch.
  - The backend's dependencies stay small.
  - Changing the ML model means regenerating the CSV, and a test checks that the regeneration matches.
