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

---

## Results (computed after the rule above was committed)

Produced by `python analysis/correction.py dev`, then a single `python analysis/correction.py vault`. The vault script writes `analysis/vault-2025/VAULT_RUN.txt` and refuses to run a second time. As a check that the baseline is wired correctly, the current correction's January 2026 MAE (1,383 MW) matches the app.

### Development: Nov 2025 – Sep 2026 (7,679 hours, 16 Nov 2025 – 1 Oct 2026)

| month | hours | raw MAE | current MAE | candidate MAE | current bias | candidate bias | MAE lower | \|bias\| higher |
|---|---|---|---|---|---|---|---|---|
| 2025-11 | 384 | 1,775 | 1,684 | 1,389 | +288 | +31 | yes | no |
| 2025-12 | 744 | 2,082 | 1,609 | 1,386 | +45 | −14 | yes | no |
| 2026-01 | 744 | 2,022 | 1,383 | 1,348 | +320 | +125 | yes | no |
| 2026-02 | 672 | 1,675 | 1,210 | 1,203 | −32 | −228 | yes | yes |
| 2026-03 | 743 | 2,114 | 977 | 941 | +57 | +138 | yes | yes |
| 2026-04 | 720 | 1,908 | 1,120 | 1,171 | −49 | −16 | no | no |
| 2026-05 | 744 | 1,190 | 949 | 953 | +42 | +124 | no | yes |
| 2026-06 | 720 | 1,482 | 1,022 | 1,059 | +142 | +293 | no | yes |
| 2026-07 | 744 | 1,118 | 866 | 911 | −168 | −227 | no | yes |
| 2026-08 | 744 | 1,029 | 882 | 940 | +83 | +49 | no | no |
| 2026-09 | 720 | 2,306 | 1,384 | 1,309 | +314 | +342 | yes | yes |

Pooled MAE goes from 1,166 to 1,134 MW and bias from +86 to +59 MW, but month by month the picture is mixed. MAE is lower in 6 of 11 months and |bias| is higher in 6 of 11. The candidate wins clearly in winter (Nov −295 MW, Dec −223 MW) and loses in Apr–Aug. 96% of hours used a band ratio rather than the fallback. These results were reported before the vault was fetched and did not change the rule.

### Vault: Jan – Oct 2025, one run (7,296 hours, 2 Jan – 1 Nov 2025)

| month | hours | raw MAE | current MAE | candidate MAE | current bias | candidate bias | MAE lower | \|bias\| higher |
|---|---|---|---|---|---|---|---|---|
| 2025-01 | 744 | 1,428 | 1,049 | 1,219 | −197 | −334 | no | yes |
| 2025-02 | 672 | 1,890 | 1,236 | 1,199 | +283 | +476 | yes | yes |
| 2025-03 | 743 | 1,932 | 957 | 994 | +25 | +37 | no | yes |
| 2025-04 | 720 | 1,030 | 873 | 865 | −84 | −115 | yes | yes |
| 2025-05 | 744 | 1,194 | 1,232 | 1,269 | +93 | +109 | no | yes |
| 2025-06 | 720 | 1,831 | 1,212 | 1,170 | +120 | +190 | yes | yes |
| 2025-07 | 744 | 1,284 | 899 | 911 | −112 | −141 | no | yes |
| 2025-08 | 744 | 1,752 | 1,167 | 1,199 | +336 | +347 | no | yes |
| 2025-09 | 720 | 1,568 | 1,149 | 1,183 | +53 | +64 | no | yes |
| 2025-10 | 745 | 2,171 | 1,280 | 1,315 | +200 | −162 | no | no |

**Applying the rule:**

- MAE lower in **3 of 10** months; at least 8 needed. ✗
- |bias| higher in **9 of 10** months; at most 2 allowed. ✗
- Without October, the month disclosed above: 3 of 9 and 9 of 9, so the same outcome.

## Verdict: FAIL. The app keeps the current 7-day single-ratio correction.

Pooled vault MAE is worse (1,105 → 1,133 MW). The pooled bias looks better (+70 → +43 MW) only because monthly biases of opposite sign cancel out; month by month the candidate's bias is larger in 9 of 10. In January 2025 the candidate even made MAE worse by 170 MW, although January 2026 was one of its development wins.

One possible reason, which has not been tested: splitting 14 days of history into four bands leaves each ratio resting on fewer hours, and on older ones, than the single 7-day ratio, so the gain from following the level effect may be smaller than the cost of a noisier, staler estimate. The level effect itself is real (`docs/error-anatomy.md` §3); this candidate just isn't a reliable way to use it. Any further attempt has to be confirmed on data from November 2026 onwards (`docs/data-usage.md`).
