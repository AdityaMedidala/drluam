"""Out-of-sample validation and sensitivity of the decision-forecast correction.

Runs the app's own analysis functions (backend/app/analysis.py, unchanged) on
months the app was never tuned on, and varies one setting at a time. Nothing
here changes app behaviour or defaults.

Data (not shipped with the app, which is scoped to January):
    python backend/scripts/fetch_data.py --first-delivery 2025-11-02 --last-delivery 2026-04-01 --out-dir analysis/data

Usage (from the repo root):
    python analysis/validate.py            # prints the markdown tables used in docs/validation.md

A "month" is the month the buy DECISION was made (delivery day D, decision on
D-1), matching the app's January scope (delivery 2 Jan - 1 Feb).
"""
from __future__ import annotations

import sys
from datetime import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import analysis as an  # noqa: E402

DATA_DIR = ROOT / "analysis" / "data"
MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
CUTOFF = time(9, 0)


# --------------------------------------------------------------------------- data
def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    actuals = pd.read_csv(DATA_DIR / "actuals_wind.csv")
    actuals["startTime"] = pd.to_datetime(actuals["startTime"], utc=True)
    forecasts = pd.read_csv(DATA_DIR / "forecasts_wind.csv")
    for col in ("publishTime", "startTime"):
        forecasts[col] = pd.to_datetime(forecasts[col], utc=True)
    return forecasts, actuals


def decision_month(frame: pd.DataFrame) -> pd.Series:
    return (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")


# --------------------------------------------------------------------------- variants
def history_mask(frame: pd.DataFrame, cutoff_utc, days: int) -> pd.Series:
    """Same 'known at the cutoff' window as analysis.build_decision_frame."""
    known_at = frame["startTime"] + an.ACTUAL_PERIOD
    return frame["actual"].notna() & (known_at <= cutoff_utc) & (known_at > cutoff_utc - pd.Timedelta(days=days))


def with_band(frame: pd.DataFrame, residual_days: int) -> pd.DataFrame:
    """Recompute the out-of-sample band over a different residual window (ratio unchanged)."""
    residual = frame["actual"] - frame["adjusted"]
    rows = []
    for day, cutoff_utc in frame.groupby("deliveryDate")["cutoffUtc"].first().items():
        res = residual[history_mask(frame, cutoff_utc, residual_days)].dropna()
        ok = len(res) >= an.MIN_HISTORY_POINTS
        rows.append((day, res.quantile(0.1) if ok else np.nan, res.quantile(0.9) if ok else np.nan))
    band = pd.DataFrame(rows, columns=["deliveryDate", "p10", "p90"])
    out = frame.drop(columns=["low", "high"]).merge(band, on="deliveryDate", how="left")
    out["low"], out["high"] = out["adjusted"] + out["p10"], out["adjusted"] + out["p90"]
    return out


def with_additive_baseline(frame: pd.DataFrame, days: int = an.TRAILING_DAYS) -> pd.DataFrame:
    """Baseline: subtract last week's mean decision-forecast error instead of scaling."""
    rows = []
    for day, cutoff_utc in frame.groupby("deliveryDate")["cutoffUtc"].first().items():
        hist = frame[history_mask(frame, cutoff_utc, days)]
        rows.append((day, hist["error"].mean() if len(hist) >= an.MIN_HISTORY_POINTS else np.nan))
    shift = pd.DataFrame(rows, columns=["deliveryDate", "meanError"])
    out = frame.merge(shift, on="deliveryDate", how="left")
    out["adjusted"] = out["forecast"] - out["meanError"]
    out["adjError"] = out["adjusted"] - out["actual"]
    return out


# --------------------------------------------------------------------------- metrics
def month_metrics(frame: pd.DataFrame) -> pd.DataFrame:
    """Per decision month, on hours with both an actual and an adjusted forecast."""
    f = frame.dropna(subset=["actual", "adjusted"]).copy()
    f["month"] = decision_month(f)
    rows = []
    for month in MONTHS:
        g = f[f["month"] == month]
        daily = g.groupby("deliveryDate").agg(raw=("error", lambda e: e.abs().mean()), adj=("adjError", lambda e: e.abs().mean()))
        rows.append({
            "month": month,
            "hours": len(g),
            "raw MAE": g["error"].abs().mean(),
            "adj MAE": g["adjError"].abs().mean(),
            "MAE cut": 1 - g["adjError"].abs().mean() / g["error"].abs().mean(),
            "raw bias": g["error"].mean(),
            "adj bias": g["adjError"].mean(),
            "bias removed": 1 - g["adjError"].mean() / g["error"].mean(),
            "days beat": f"{int((daily['adj'] < daily['raw']).sum())}/{len(daily)}",
            "coverage": an.band_coverage(g).get("coverage", np.nan) if "low" in g else np.nan,
            "width": (g["high"] - g["low"]).mean() if "low" in g else np.nan,
        })
    return pd.DataFrame(rows).set_index("month")


def cell(col: str, v) -> str:
    if isinstance(v, str):
        return v
    if pd.isna(v):
        return "–"
    if "cut" in col or "removed" in col or "coverage" in col:
        return f"{v:.0%}"
    if "bias" in col:
        return f"{v:+,.0f}"
    return f"{v:,.0f}"


def table(df: pd.DataFrame) -> str:
    """Markdown table (MW figures; no tabulate dependency)."""
    cols = list(df.columns)
    lines = ["| month | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for idx, row in df.iterrows():
        lines.append(f"| {idx} | " + " | ".join(cell(c, row[c]) for c in cols) + " |")
    return "\n".join(lines) + "\n"


def main() -> None:
    forecasts, actuals = load()
    base = an.build_decision_frame(forecasts, actuals, CUTOFF)

    # Sanity: the band re-implementation must reproduce the app's 7-day band exactly.
    redo = with_band(base, an.TRAILING_DAYS)
    assert np.allclose(redo["low"], base["low"], equal_nan=True) and np.allclose(redo["high"], base["high"], equal_nan=True)
    scoped = base[decision_month(base).isin(MONTHS)]
    full = scoped.groupby("deliveryDate")[["historyPoints", "bandPoints"]].first()
    print(f"<!-- {len(full)} delivery days; full 168-hour history and band on every day: {bool((full == 168).all().all())} -->\n")

    m = month_metrics(base)
    print("### 1. Per month (09:00 cutoff, app defaults)\n")
    print(table(m[["hours", "raw MAE", "adj MAE", "MAE cut", "raw bias", "adj bias", "bias removed", "days beat", "coverage"]]))

    print("### 2. Ratio window (days of history for the scaling ratio)\n")
    by_window = {d: month_metrics(an.build_decision_frame(forecasts, actuals, CUTOFF, trailing_days=d)) for d in (3, 7, 14)}
    t = pd.DataFrame({f"{d}d {k}": by_window[d][k] for k in ("adj MAE", "adj bias", "days beat") for d in (3, 7, 14)})
    print(table(t))

    print("### 3. Band residual window (ratio fixed at 7 days)\n")
    b7, b14 = month_metrics(with_band(base, 7)), month_metrics(with_band(base, 14))
    print(table(pd.DataFrame({"7d coverage": b7["coverage"], "14d coverage": b14["coverage"],
                              "7d width": b7["width"], "14d width": b14["width"]})))

    print("### 4. Decision cutoff (what does waiting for a later run buy?)\n")
    by_cut = {c: month_metrics(an.build_decision_frame(forecasts, actuals, time.fromisoformat(c))) for c in ("06:00", "09:00", "09:30")}
    print(table(pd.DataFrame({f"{c} {k}": by_cut[c][k] for k in ("raw MAE", "adj MAE", "coverage") for c in by_cut})))

    print("### 5. Baseline: subtract last week's mean error instead of scaling\n")
    add = month_metrics(with_additive_baseline(base))
    print(table(pd.DataFrame({"ratio adj MAE": m["adj MAE"], "additive adj MAE": add["adj MAE"],
                              "ratio adj bias": m["adj bias"], "additive adj bias": add["adj bias"],
                              "ratio days beat": m["days beat"], "additive days beat": add["days beat"]})))


if __name__ == "__main__":
    main()
