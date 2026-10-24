"""Load the cached Elexon extracts (written by scripts/fetch_data.py).

January 2026 is historical and fixed, so the app serves a local snapshot instead
of calling Elexon on every request: fast, deterministic, and it keeps working if
the upstream API is slow or down. Re-run the fetch script to refresh.
"""
from __future__ import annotations

import os
from datetime import date
from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[1] / "data"))

# Purchase decisions made in January 2026 -> delivery days 2 Jan .. 1 Feb.
FIRST_DELIVERY = date(2026, 1, 2)
LAST_DELIVERY = date(2026, 2, 1)


@lru_cache(maxsize=1)
def load_actuals() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "actuals_wind.csv")
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    return df.sort_values("startTime").reset_index(drop=True)


@lru_cache(maxsize=1)
def load_forecasts() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "forecasts_wind.csv")
    for col in ("publishTime", "startTime"):
        df[col] = pd.to_datetime(df[col], utc=True)
    return df.sort_values(["publishTime", "startTime"]).reset_index(drop=True)
