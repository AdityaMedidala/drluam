"""Curtailment check: does adding accepted wind bid volumes back to FUELHH close the gap to WINDFOR?

FUELHH WIND is metered output, so it is net of any balancing-mechanism bids
the system operator accepted to turn wind farms down. If WINDFOR forecasts
what the farms could generate, the gap should shrink once those bid volumes
are added back. This is the test used in the literature; it uses data outside
the brief (Elexon BOAV), so it lives here and never in the app.

Data:
  - the app's January snapshot (backend/data), decisions 1-31 Jan 2026, cutoff 09:20
  - Elexon BOAV bid acceptance volumes per BM unit and settlement period,
    settlement dates 2 Jan - 1 Feb 2026, kept for BM units whose fuelType is
    WIND in Elexon's BM unit reference list (fetched at run time)

Usage (from the repo root):
    python analysis/curtailment_check.py --fetch   # download BOAV once (~220 MB over the wire)
    python analysis/curtailment_check.py           # print the tables for docs/curtailment-check.md
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import analysis as an  # noqa: E402
from app.data import FIRST_DELIVERY, LAST_DELIVERY, load_actuals, load_forecasts  # noqa: E402

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
OUT = ROOT / "analysis" / "curtailment"
CSV = OUT / "boav_wind_bids.csv"
CUTOFF = time(9, 20)
WORST_DAYS = [date(2026, 1, d) for d in (2, 11, 21, 28)]


def fetch() -> None:
    units = requests.get(f"{BASE}/reference/bmunits/all", timeout=120).json()
    wind = {u["elexonBmUnit"] for u in units if u.get("fuelType") == "WIND"}
    rows, d = [], FIRST_DELIVERY
    while d <= LAST_DELIVERY:
        r = requests.get(f"{BASE}/balancing/settlement/acceptance/volumes/all/bid/{d.isoformat()}", timeout=300)
        r.raise_for_status()
        data = r.json()["data"]
        if not data:
            sys.exit(f"BOAV returned no rows for {d}")
        day = pd.DataFrame(data)
        day = day[day["bmUnit"].isin(wind)]
        rows.append(day[["startTime", "settlementDate", "settlementPeriod", "bmUnit", "acceptanceId", "totalVolumeAccepted"]])
        print(f"BOAV {d}: {len(day)} wind rows, {day['totalVolumeAccepted'].sum():,.0f} MWh")
        d += timedelta(days=1)
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.concat(rows, ignore_index=True)
    df.to_csv(CSV, index=False)
    manifest = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"{BASE}/balancing/settlement/acceptance/volumes/all/bid/{{settlementDate}} (BOAV)",
        "settlementDates": [FIRST_DELIVERY.isoformat(), LAST_DELIVERY.isoformat()],
        "windBmUnitsInReference": len(wind),
        "windBmUnitsWithBids": int(df["bmUnit"].nunique()),
        "rows": len(df),
        "file": CSV.name,
        "sha256": hashlib.sha256(CSV.read_bytes()).hexdigest(),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def curtailed_mw() -> pd.Series:
    """Accepted wind bid volume per half-hour, as average MW (bids are negative MWh; flip the sign)."""
    b = pd.read_csv(CSV, parse_dates=["startTime"])
    return (-b.groupby("startTime")["totalVolumeAccepted"].sum() / 0.5).rename("curtailedMW")


def metrics(err: pd.Series) -> str:
    return f"bias {err.mean():+,.0f} MW, MAE {err.abs().mean():,.0f} MW"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--fetch", action="store_true")
    if p.parse_args().fetch:
        fetch()

    frame = an.in_scope(an.build_decision_frame(load_forecasts(), load_actuals(), CUTOFF), FIRST_DELIVERY, LAST_DELIVERY)
    f = frame.dropna(subset=["actual"]).copy()
    f = f.merge(curtailed_mw(), left_on="startTime", right_index=True, how="left").fillna({"curtailedMW": 0.0})
    f["unconstrained"] = f["actual"] + f["curtailedMW"]
    f["gap"] = f["forecast"] - f["actual"]
    f["gapAfter"] = f["forecast"] - f["unconstrained"]

    print(f"Hours: {len(f)} (delivery {FIRST_DELIVERY} - {LAST_DELIVERY}, cutoff {CUTOFF:%H:%M})")
    print(f"Mean accepted wind bids: {f['curtailedMW'].mean():,.0f} MW; hours with any: {(f['curtailedMW'] > 0).mean():.0%}")
    print(f"Raw forecast vs FUELHH actual:             {metrics(f['gap'])}, over-forecast in {(f['gap'] > 0).mean():.0%} of hours")
    print(f"Raw forecast vs actual + accepted bids:    {metrics(f['gapAfter'])}, over-forecast in {(f['gapAfter'] > 0).mean():.0%} of hours")
    print(f"Share of the mean gap explained: {f['curtailedMW'].mean() / f['gap'].mean():.0%}\n")

    daily = f.groupby("deliveryDate").agg(gap=("gap", "mean"), curtailed=("curtailedMW", "mean"),
                                          gapAfter=("gapAfter", "mean"), actual=("actual", "mean"),
                                          forecast=("forecast", "mean"))
    daily["ratio"] = daily["actual"] / daily["forecast"]
    daily["ratioAfter"] = (daily["actual"] + daily["curtailed"]) / daily["forecast"]
    print(f"Daily correlation of mean gap with mean accepted bids: {daily['gap'].corr(daily['curtailed']):.2f} (Pearson), "
          f"{daily['gap'].corr(daily['curtailed'], method='spearman'):.2f} (Spearman)")
    print(f"Days where accepted bids exceed the gap: {(daily['curtailed'] > daily['gap']).sum()} of {len(daily)}\n")

    by_level = f.groupby(pd.cut(f["forecast"], [0, 5000, 10000, 15000, 30000], labels=["<5 GW", "5-10 GW", "10-15 GW", ">15 GW"]),
                         observed=True).agg(hours=("gap", "size"), gap=("gap", "mean"), curtailed=("curtailedMW", "mean"),
                                            gapAfter=("gapAfter", "mean"))
    print("By forecast level (mean MW):")
    print(by_level.round(0).to_string(), "\n")

    print("Worst days for the band (mean MW):")
    print(daily.loc[WORST_DAYS, ["forecast", "actual", "curtailed", "gap", "gapAfter", "ratio", "ratioAfter"]].round(2).to_string())

    print("\nDaily table:")
    print(daily[["gap", "curtailed", "gapAfter"]].round(0).to_string())


if __name__ == "__main__":
    main()
