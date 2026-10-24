"""Backtest the Decision view's cost-aware exceedance level on every development month.

Each plan is the app's own (`analysis.py`), at the app's default cutoff. Hourly cost
= short x MWh planned but not delivered + long x MWh delivered beyond the plan
(`analysis.plan_cost`); every plan is scored on the same hours. Illustrative: the
costs are assumptions, and nothing here changes the method.

Usage (from the repo root, data as in analysis/error_anatomy.py):
    python analysis/cost_backtest.py      # prints the markdown tables for docs/cost-backtest.md
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

CUTOFF = time(9, 20)  # the app default
MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
DEFAULT = (100, 30)   # GBP/MWh short, long: the app's illustrative defaults
SENSITIVITY = [(30, 100), (50, 50), (60, 40), (100, 30), (100, 15), (200, 20), (500, 25)]
LABELS = {**{f"P{c}": f"P{c}" for c in an.PLAN_CONFIDENCES}, "forecast": "NESO forecast", "adjusted": "bias-corrected forecast"}


def gbp_m(v: float, signed: bool = False) -> str:
    s = f"{abs(v) / 1e6:,.1f}"
    if not signed:
        return s
    return "0.0" if abs(v) < 5e4 else ("−" if v < 0 else "+") + s


def main() -> None:
    forecasts, actuals = load()
    frame = an.build_decision_frame(forecasts, actuals, CUTOFF)
    frame["month"] = (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    scored = frame[(frame["bandPoints"] == 168) & frame["month"].isin(MONTHS)]

    short, long = DEFAULT
    rec = an.recommended_level(short, long)["level"]
    pooled = an.cost_backtest(scored, short, long)
    print(f"## Pooled, Nov 2025 – Sep 2026, short £{short}, long £{long} ({pooled['hours']:,} hours)\n")
    print(md(pd.DataFrame(
        [{"plan on": LABELS[r["key"]], "cost (£m)": gbp_m(r["costGBP"]), "vs NESO forecast (£m)":
          "–" if r["key"] == "forecast" else gbp_m(r["vsNesoGBP"], signed=True)} for r in pooled["rows"]]), index=False))

    print(f"\n## Lowest-cost level by month, short £{short}, long £{long}\n")
    rows = []
    for m in MONTHS:
        bt = an.cost_backtest(scored[scored["month"] == m], short, long)
        cost = {r["key"]: r for r in bt["rows"]}
        rows.append({"decision month": m, "hours": bt["hours"], "lowest-cost level": f"P{bt['bestLevel']}",
                     f"P{rec} vs NESO forecast (£m)": gbp_m(cost[f"P{rec}"]["vsNesoGBP"], signed=True),
                     f"lowest-cost level vs P{rec} (£m)":
                         gbp_m(cost[f"P{bt['bestLevel']}"]["costGBP"] - cost[f"P{rec}"]["costGBP"], signed=True)})
    print(md(pd.DataFrame(rows), index=False))

    print("\n## Theory vs backtest across cost assumptions (pooled)\n")
    rows = []
    for s, lg in SENSITIVITY:
        r = an.recommended_level(s, lg)
        bt = an.cost_backtest(scored, s, lg)
        cost = {x["key"]: x["costGBP"] for x in bt["rows"]}
        rows.append({"short (£/MWh)": s, "long (£/MWh)": lg, "critical ratio": f"P{r['exact']:.0f}",
                     "recommended": f"P{r['level']}" + (" (snapped)" if r["snapped"] else ""),
                     "lowest-cost level": f"P{bt['bestLevel']}",
                     "recommended vs NESO forecast (£m)": gbp_m(cost[f"P{r['level']}"] - cost["forecast"], signed=True),
                     "lowest row overall": LABELS[bt["lowest"]]})
    print(md(pd.DataFrame(rows), index=False))


if __name__ == "__main__":
    main()
