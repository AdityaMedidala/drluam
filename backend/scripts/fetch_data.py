"""Fetch wind actuals (FUELHH) and wind forecasts (WINDFOR) from Elexon BMRS.

Scope: purchase decisions made in January 2026
  -> decision days 2026-01-01 .. 2026-01-31
  -> delivery days 2026-01-02 .. 2026-02-01

Usage (from the repo root):
    python backend/scripts/fetch_data.py

Writes:
    backend/data/actuals_wind.csv    startTime, settlementDate, settlementPeriod, generation
    backend/data/forecasts_wind.csv  publishTime, startTime, generation
"""
import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SESSION = requests.Session()


def get_rows(url: str, params: dict, retries: int = 4) -> list[dict]:
    """GET a stream endpoint and return its rows, retrying on network/5xx/429 errors."""
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=60)
            if r.status_code == 400:
                # Bad parameters won't fix themselves -- show the API's message and stop.
                sys.exit(f"400 Bad Request for {r.url}\n{r.text[:500]}")
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            body = r.json()
            # Stream endpoints return a bare list; non-stream ones wrap it in {"data": [...]}.
            return body["data"] if isinstance(body, dict) else body
        except (requests.RequestException, ValueError) as exc:
            wait = 2**attempt
            print(f"  retry {attempt + 1}/{retries} in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"Giving up on {url} {params}")


def fetch_actuals(start: date, end: date, chunk_days: int = 7) -> pd.DataFrame:
    """Half-hourly WIND generation for settlement dates start..end (inclusive)."""
    rows, day = [], start
    while day <= end:
        chunk_end = min(day + timedelta(days=chunk_days - 1), end)
        print(f"FUELHH  {day} -> {chunk_end}")
        batch = get_rows(
            f"{BASE}/FUELHH/stream",
            {"settlementDateFrom": day.isoformat(), "settlementDateTo": chunk_end.isoformat(), "fuelType": "WIND"},
        )
        if not batch:
            print("  WARNING: no rows returned for this chunk")
        rows.extend(batch)
        day = chunk_end + timedelta(days=1)

    df = pd.DataFrame(rows)
    df = df[df["fuelType"] == "WIND"]  # belt and braces in case the filter is ignored
    df = df[["startTime", "settlementDate", "settlementPeriod", "generation"]]
    return df.drop_duplicates("startTime").sort_values("startTime")


def fetch_forecasts(start: datetime, end: datetime, chunk_hours: int = 24) -> pd.DataFrame:
    """Every WINDFOR forecast published between start and end (UTC)."""
    rows, t = [], start
    while t < end:
        chunk_end = min(t + timedelta(hours=chunk_hours), end)
        print(f"WINDFOR {t:%Y-%m-%d %H:%M} -> {chunk_end:%Y-%m-%d %H:%M}")
        batch = get_rows(
            f"{BASE}/WINDFOR/stream",
            {"publishDateTimeFrom": t.strftime("%Y-%m-%dT%H:%MZ"), "publishDateTimeTo": chunk_end.strftime("%Y-%m-%dT%H:%MZ")},
        )
        if not batch:
            print("  WARNING: no rows returned for this chunk")
        rows.extend(batch)
        t = chunk_end

    df = pd.DataFrame(rows)[["publishTime", "startTime", "generation"]]
    return df.drop_duplicates(["publishTime", "startTime"]).sort_values(["publishTime", "startTime"])


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--first-delivery", default="2026-01-02")
    p.add_argument("--last-delivery", default="2026-02-01")
    args = p.parse_args()

    first = date.fromisoformat(args.first_delivery)
    last = date.fromisoformat(args.last_delivery)

    # Extra history before the first delivery day: the bias correction looks back
    # 7 days from each decision, so early-January decisions need late-December data.
    history = timedelta(days=9)
    actuals = fetch_actuals(first - history, last + timedelta(days=1))
    # Forecasts published from the start of that history window up to the end of
    # the last decision day.
    pub_start = datetime.combine(first - history - timedelta(days=2), datetime.min.time(), timezone.utc)
    pub_end = datetime.combine(last, datetime.min.time(), timezone.utc)
    forecasts = fetch_forecasts(pub_start, pub_end)

    DATA_DIR.mkdir(exist_ok=True)
    actuals.to_csv(DATA_DIR / "actuals_wind.csv", index=False)
    forecasts.to_csv(DATA_DIR / "forecasts_wind.csv", index=False)
    print(f"\nSaved {len(actuals):,} actual rows and {len(forecasts):,} forecast rows to {DATA_DIR}")


if __name__ == "__main__":
    main()
