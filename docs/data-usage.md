# Data usage log

Which periods have been used for what, so that no "confirmation" is run on data that has already shaped a decision.

| Period (decision months) | Used for | Status |
|---|---|---|
| Jan 2026 | The app's scope and headline numbers | In use |
| Nov 2025 – Mar 2026 | `validation.md` sensitivity; selection in `uncertainty.md`; development in `correction.md` | Seen |
| Apr – Sep 2026 | Holdout in `uncertainty.md` (only reported, as no candidate reached it); `validation.md` addendum on the 14-day band; development in `correction.md` | Seen |
| Jan – Oct 2025 (the "vault") | One confirmation run of the level-aware correction (`correction.md`), 24 Oct 2026 05:28 UTC, marker `analysis/vault-2025/VAULT_RUN.txt` | **Used. No longer a holdout.** |
| 15–31 Oct 2025 | Warm-up history for November 2025 ratios in `validation.md` (never scored), later part of the vault | Used |

**Any future change to the correction or the uncertainty band must be pre-registered and confirmed on data from November 2026 onwards.** None of the periods above can serve as a confirmation any more. Candidates already waiting for that test: the 14-day band residual window (`validation.md` addendum).
