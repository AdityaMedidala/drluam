"""Backtest the app's "plan on C%" number on every development month.

The plan for each hour is the app's own (`analysis.py`): adjusted forecast + the
(1 - C) quantile of the trailing week's out-of-sample residuals, floored at 0.
Hit rate = share of hours where the actual came in at or above the plan; the
target is C. Not a method change: the app's logic runs unchanged, at the app's
default cutoff.

Usage (from the repo root, data as in analysis/error_anatomy.py):
    python analysis/plan_backtest.py      # prints the markdown table for docs/plan-backtest.md
"""
from __future__ import annotations

import sys
from datetime import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "analysis"))
from app import analysis as an  # noqa: E402
from error_anatomy import load, md  # noqa: E402  (nothing before 1 Nov 2025; the vault is not used)

CUTOFF = time(9, 20)  # the app default; no WINDFOR run falls between 09:00 and 09:20 UK
MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]


def main() -> None:
    forecasts, actuals = load()
    frame = an.build_decision_frame(forecasts, actuals, CUTOFF)
    # Month of the decision (D-1), as in docs/uncertainty.md; only hours with a full week of residuals.
    frame["month"] = (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    scored = frame[(frame["bandPoints"] == 168) & frame["month"].isin(MONTHS)]

    rows = {}
    for m in MONTHS + ["all"]:
        g = scored if m == "all" else scored[scored["month"] == m]
        rows[m] = {"hours": an.plan_hit_rate(g, 50)["n"],
                   **{f"P{c}": an.plan_hit_rate(g, c)["hitRate"] for c in an.PLAN_CONFIDENCES}}
    table = pd.DataFrame(rows).T
    table["hours"] = table["hours"].astype(int)
    for c in an.PLAN_CONFIDENCES:
        table[f"P{c}"] = table[f"P{c}"].map("{:.0%}".format)
    table.index.name = "decision month"
    print(f"Target hit rate: {', '.join(f'P{c} = {c}%' for c in an.PLAN_CONFIDENCES)}\n")
    print(md(table))


if __name__ == "__main__":
    main()
