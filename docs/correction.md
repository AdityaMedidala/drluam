# Level-aware correction

## Decision rule (written and committed before any evaluation, and before the vault was fetched)

The rule below was committed before the candidate was evaluated on any data and before the Jan–Oct 2025 vault was downloaded. It is applied exactly as written; the commit history shows it was not edited after results were known.

### Why try this

`docs/error-anatomy.md` found that the error grows with wind level. Actual/forecast falls from about 0.9 below 12 GW to 0.78 above 20 GW, and nine of the ten worst days were high-wind days. A single ratio can't follow that: it over-scales at one end of the range and under-scales at the other.

### Current correction (baseline)

This is the app's correction: adjusted = forecast × Σactual / Σforecast over the trailing 7 days of hours known at the cutoff (startTime + 30 min ≤ cutoff), with at least 24 hours required (`analysis.py`, unchanged).

### Candidate: a ratio per forecast-level band

- **Bands:** each hour falls in one of four bands according to its raw decision-time forecast: <5 GW, 5–10 GW, 10–15 GW, ≥15 GW (lower edges inclusive).
- **Window:** the trailing 14 days of hours known at the cutoff (startTime + 30 min ≤ cutoff and > cutoff − 14 days), with the same "known" rule as the app.
- **Ratio per band:** Σactual / Σforecast over the window hours in that band.
- **Adjusted forecast:** each target hour on D gets forecast × its band's ratio. If that band has fewer than 24 hours in the window, it falls back to the current single 7-day ratio.
- **Fixed in advance:** no band edges, window lengths or thresholds are tuned.

### Data

- **Development:** decision months Nov 2025 – Sep 2026, from `analysis/data` and `analysis/data-2026-04-09`, reading nothing published or timestamped before 1 Nov 2025. Only delivery days whose cutoff is at least 14 days after 1 Nov 2025 are scored, so both corrections have full windows.
- **Vault, used exactly once:** decision months Jan – Oct 2025, delivery days 2 Jan – 1 Nov 2025. It is fetched after this commit into `analysis/vault-2025/` with 16 days of history. All 10 months are scored.
  - **Disclosure:** data for 15–31 Oct 2025 already exists in `analysis/data`. It was fetched as warm-up history for `docs/validation.md` and used only as input to November's ratios; no Oct 2025 forecast error was ever scored or looked at.
  - The verdict uses all 10 vault months as specified. For transparency, the vault result is also reported without October.
- **Scoring:** MAE and bias of the adjusted forecast, per decision month, on hours where both corrections produce a value. A month is the month of the decision (D−1), as elsewhere.

### Confirmation, a single run on the vault

The candidate is **adopted** only if both of these hold on the vault:

1. its monthly MAE is strictly lower than the current correction's in **at least 8 of the 10** months; **and**
2. its monthly absolute bias, |mean(adjusted − actual)|, is strictly higher than the current correction's in **no more than 2 of the 10** months.

Otherwise it is rejected and the app keeps the current correction. The development results do not affect the verdict; they are reported first, before the vault is fetched.

### After the vault run

The vault is then spent. That is recorded in `docs/data-usage.md`, and any future change to the correction or band has to be confirmed on data from **November 2026 onwards**.

### If adopted

It is implemented in the app test-first, with the golden test, README and UI method note updated.
