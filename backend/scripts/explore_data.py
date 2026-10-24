"""Answer the Phase 0 questions about the data before building anything.

Usage (from the repo root, after fetch_data.py):
    python backend/scripts/explore_data.py
    python backend/scripts/explore_data.py --cutoff 09:30

Prints:
  1. Actuals: time resolution, gaps, value range
  2. Forecasts: how often they're published, at what times, their resolution and horizon
  3. A first look at the decision forecast vs actuals (coverage, bias, MAE)
"""
import argparse
import sys
from datetime import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.analysis import select_decision_forecast  # noqa: E402

DATA_DIR = ROOT / "backend" / "data"


def header(title: str) -> None:
    print(f"\n{'=' * 60}\n{title}\n{'=' * 60}")


def steps(series: pd.Series) -> pd.Series:
    """Most common gaps (in minutes) between consecutive timestamps."""
    gaps = series.drop_duplicates().sort_values().diff().dropna().dt.total_seconds() / 60
    return gaps.value_counts().head(5)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--cutoff", default="09:00", help="Decision time on D-1, UK local (HH:MM)")
    args = p.parse_args()
    cutoff = time.fromisoformat(args.cutoff)

    actuals = pd.read_csv(DATA_DIR / "actuals_wind.csv", parse_dates=["startTime"])
    forecasts = pd.read_csv(DATA_DIR / "forecasts_wind.csv", parse_dates=["publishTime", "startTime"])
    for df, cols in ((actuals, ["startTime"]), (forecasts, ["publishTime", "startTime"])):
        for c in cols:
            df[c] = pd.to_datetime(df[c], utc=True)

    # ---------------------------------------------------------------- actuals
    header("ACTUALS (FUELHH, WIND)")
    print(f"Rows: {len(actuals):,}")
    print(f"Range: {actuals.startTime.min()} -> {actuals.startTime.max()}")
    print("Gap between readings (minutes -> count):")
    print(steps(actuals.startTime).to_string())
    expected = pd.date_range(actuals.startTime.min(), actuals.startTime.max(), freq="30min")
    missing = expected.difference(actuals.startTime)
    print(f"Missing half-hours: {len(missing)}" + (f" e.g. {list(missing[:3])}" if len(missing) else ""))
    print("Generation (MW):")
    print(actuals.generation.describe().round(0).to_string())

    # -------------------------------------------------------------- forecasts
    header("FORECASTS (WINDFOR)")
    print(f"Rows: {len(forecasts):,}")
    pubs = forecasts.publishTime.drop_duplicates().sort_values()
    print(f"Distinct publish times: {len(pubs):,}  ({pubs.min()} -> {pubs.max()})")
    per_day = pubs.groupby(pubs.dt.date).size()
    print(f"Forecasts published per day: min {per_day.min()}, median {per_day.median():.0f}, max {per_day.max()}")
    print("Most common publish times of day (UTC):")
    print(pubs.dt.strftime("%H:%M").value_counts().sort_index().head(30).to_string())
    print("Gap between target times within one forecast (minutes -> count):")
    within = forecasts.sort_values(["publishTime", "startTime"]).groupby("publishTime").startTime.diff().dropna()
    print((within.dt.total_seconds() / 60).value_counts().head(5).to_string())
    horizon = (forecasts.startTime - forecasts.publishTime).dt.total_seconds() / 3600
    print("Forecast horizon, startTime - publishTime (hours):")
    print(horizon.describe().round(1).to_string())
    print(f"Rows with negative horizon (target before publish): {(horizon < 0).sum():,}")

    # ------------------------------------------------- decision-time preview
    header(f"DECISION FORECAST vs ACTUAL  (cutoff {cutoff:%H:%M} UK on D-1)")
    chosen = select_decision_forecast(forecasts, cutoff)
    first, last = pd.Timestamp("2026-01-02").date(), pd.Timestamp("2026-02-01").date()
    chosen = chosen[(chosen.deliveryDate >= first) & (chosen.deliveryDate <= last)]
    merged = chosen.merge(actuals[["startTime", "generation"]], on="startTime", how="inner")
    merged["error"] = merged.forecast - merged.generation  # +ve = over-forecast = risk of under-buying

    slots = 24 * ((last - first).days + 1)
    print(f"Target hours in scope (forecasts are hourly): {slots:,}")
    print(f"With a decision forecast:   {len(chosen):,}")
    print(f"Matched to an actual:       {len(merged):,}")
    if len(merged):
        print(f"Horizon of chosen forecasts (h): {chosen.horizonHours.min():.1f} -> {chosen.horizonHours.max():.1f}")
        print(f"Bias (mean error):  {merged.error.mean():+,.0f} MW")
        print(f"MAE:                {merged.error.abs().mean():,.0f} MW")
        print(f"MAE / mean actual:  {merged.error.abs().mean() / merged.generation.mean():.1%}")
        print(f"P10 / P50 / P90 error: {merged.error.quantile([.1, .5, .9]).round(0).tolist()} MW")

    print("\nPaste this whole output back to Claude.")


if __name__ == "__main__":
    main()
