"""MAE skill scores of the raw decision forecast and the current correction,
against two references, with day-block bootstrap confidence intervals.

Skill = 1 - MAE_method / MAE_reference (positive = the method beats the reference).
References:
  raw          the raw decision forecast (only meaningful for the correction)
  persistence  the last FUELHH actual known at the decision cutoff (its half-hour
               ended at or before the cutoff), held flat for the whole delivery day
Hours: every hour with an actual and an adjusted forecast (as in the app's
raw-vs-adjusted comparison), app cutoff 09:20 UK, nothing before 1 Nov 2025.
CIs: 95% percentile intervals from 10,000 resamples of delivery days with
replacement within each month (pooled: across all months), seed 0. Fixed
before running.

Usage (from the repo root, data as in analysis/error_anatomy.py):
    python analysis/skill.py      # prints the markdown table for docs/validation.md
"""
from __future__ import annotations

import sys
from datetime import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "analysis"))
from app import analysis as an  # noqa: E402
from error_anatomy import load, md  # noqa: E402  (nothing before 1 Nov 2025; the vault is not used)

CUTOFF = time(9, 20)
MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
N_BOOT, SEED = 10_000, 0
SCORES = {  # name: (method column, reference column)
    "raw vs persistence": ("absRaw", "absPersist"),
    "adjusted vs persistence": ("absAdj", "absPersist"),
    "adjusted vs raw": ("absAdj", "absRaw"),
}


def persistence(frame: pd.DataFrame, actuals: pd.DataFrame) -> pd.Series:
    """Last actual whose half-hour ended at or before each delivery day's cutoff."""
    acts = actuals.assign(knownAt=actuals["startTime"] + an.ACTUAL_PERIOD).sort_values("knownAt")
    cutoffs = frame.groupby("deliveryDate")["cutoffUtc"].first().sort_values()
    last = pd.merge_asof(cutoffs.rename("knownAt").reset_index(), acts[["knownAt", "generation"]],
                         on="knownAt", direction="backward")
    return frame["deliveryDate"].map(dict(zip(last["deliveryDate"], last["generation"])))


def daily_sums(df: pd.DataFrame) -> pd.DataFrame:
    """Per delivery day: summed absolute errors and hour count (the bootstrap resamples these rows)."""
    return df.groupby("deliveryDate")[["absRaw", "absAdj", "absPersist"]].sum().assign(
        n=df.groupby("deliveryDate").size())


def skill_with_ci(days: pd.DataFrame, rng: np.random.Generator) -> dict:
    idx = rng.integers(0, len(days), size=(N_BOOT, len(days)))
    out = {}
    for name, (m, r) in SCORES.items():
        point = 1 - days[m].sum() / days[r].sum()
        boot = 1 - days[m].to_numpy()[idx].sum(axis=1) / days[r].to_numpy()[idx].sum(axis=1)
        lo, hi = np.percentile(boot, [2.5, 97.5])
        out[name] = (point, lo, hi)
    return out


def main() -> None:
    forecasts, actuals = load()
    frame = an.build_decision_frame(forecasts, actuals, CUTOFF)
    frame["persistence"] = persistence(frame, actuals)
    frame["month"] = (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    f = frame[frame["month"].isin(MONTHS)].dropna(subset=["actual", "adjusted", "persistence"]).copy()
    f["absRaw"] = (f["forecast"] - f["actual"]).abs()
    f["absAdj"] = (f["adjusted"] - f["actual"]).abs()
    f["absPersist"] = (f["persistence"] - f["actual"]).abs()

    rng = np.random.default_rng(SEED)
    rows = {}
    for m in MONTHS + ["all"]:
        g = f if m == "all" else f[f["month"] == m]
        days = daily_sums(g)
        s = skill_with_ci(days, rng)
        row = {"days": len(days), "hours": int(days["n"].sum()),
               "raw MAE": f"{g['absRaw'].mean():,.0f}", "adj MAE": f"{g['absAdj'].mean():,.0f}",
               "persistence MAE": f"{g['absPersist'].mean():,.0f}"}
        for name, (p, lo, hi) in s.items():
            row[name] = f"{p:+.0%} [{lo:+.0%}, {hi:+.0%}]"
        rows[m] = row
    table = pd.DataFrame(rows).T
    table.index.name = "decision month"
    print(md(table))


if __name__ == "__main__":
    main()
