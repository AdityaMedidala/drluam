"""Fetch wind actuals (FUELHH) and wind forecasts (WINDFOR) from Elexon BMRS.

Scope: purchase decisions made in January 2026
  -> decision days 2026-01-01 .. 2026-01-31
  -> delivery days 2026-01-02 .. 2026-02-01

Usage (from the repo root):
    python backend/scripts/fetch_data.py
    python backend/scripts/fetch_data.py --first-delivery 2025-11-02 --last-delivery 2026-04-01 --out-dir analysis/data

Writes:
    backend/data/actuals_wind.csv    startTime, settlementDate, settlementPeriod, publishTime, generation
    backend/data/forecasts_wind.csv  publishTime, startTime, generation
    backend/data/manifest.json       fetch time, requested and actual ranges, row counts, sha256 of each CSV

Exits non-zero (and writes nothing) if any chunk comes back empty or the
actuals have missing half-hours, so a partial snapshot can't slip in silently.
"""
import argparse
import hashlib
import json
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
            sys.exit(f"FUELHH returned no rows for {day} -> {chunk_end}")
        rows.extend(batch)
        day = chunk_end + timedelta(days=1)

    df = pd.DataFrame(rows)
    df = df[df["fuelType"] == "WIND"]  # belt and braces in case the filter is ignored
    df = df[["startTime", "settlementDate", "settlementPeriod", "publishTime", "generation"]]
    # A half-hour can be republished; keep the latest publication of each.
    df = df.sort_values(["startTime", "publishTime"]).drop_duplicates("startTime", keep="last")
    return df.reset_index(drop=True)


def missing_half_hours(actuals: pd.DataFrame) -> pd.DatetimeIndex:
    """Half-hours between the first and last actual that have no row."""
    times = pd.to_datetime(actuals["startTime"], utc=True)
    expected = pd.date_range(times.min(), times.max(), freq="30min")
    return expected.difference(times)


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
            sys.exit(f"WINDFOR returned no rows for publish window {t:%Y-%m-%d %H:%M} -> {chunk_end:%Y-%m-%d %H:%M}")
        rows.extend(batch)
        t = chunk_end

    df = pd.DataFrame(rows)[["publishTime", "startTime", "generation"]]
    return df.drop_duplicates(["publishTime", "startTime"]).sort_values(["publishTime", "startTime"])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--first-delivery", default="2026-01-02")
    p.add_argument("--last-delivery", default="2026-02-01")
    p.add_argument("--out-dir", type=Path, default=DATA_DIR, help="where to write the CSVs and manifest")
    p.add_argument("--allow-gaps", action="store_true",
                   help="analysis fetches only: keep going when FUELHH has missing half-hours and list them in the manifest")
    args = p.parse_args()
    out_dir = args.out_dir

    first = date.fromisoformat(args.first_delivery)
    last = date.fromisoformat(args.last_delivery)

    # Extra history before the first delivery day: the bias correction looks back
    # 7 days from each decision, and the band uses the out-of-sample errors of each
    # of those 7 days -- whose own ratios look back another 7 days. So the first
    # delivery day needs ~2 weeks of history (16 days covers it with margin).
    history = timedelta(days=16)
    act_start, act_end = first - history, last + timedelta(days=1)
    actuals = fetch_actuals(act_start, act_end)
    gaps = missing_half_hours(actuals)
    if len(gaps):
        message = f"FUELHH is missing {len(gaps)} half-hours, e.g. {[str(g) for g in gaps[:5]]}"
        if not args.allow_gaps:
            sys.exit(message)
        print(f"{message} (kept: --allow-gaps)")
    # Forecasts published from the start of that history window up to the end of
    # the last decision day.
    pub_start = datetime.combine(first - history - timedelta(days=2), datetime.min.time(), timezone.utc)
    pub_end = datetime.combine(last, datetime.min.time(), timezone.utc)
    forecasts = fetch_forecasts(pub_start, pub_end)

    out_dir.mkdir(parents=True, exist_ok=True)
    actuals.to_csv(out_dir / "actuals_wind.csv", index=False)
    forecasts.to_csv(out_dir / "forecasts_wind.csv", index=False)
    manifest = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": BASE,
        "actuals": {
            "dataset": "FUELHH (fuelType=WIND)",
            "file": "actuals_wind.csv",
            "sha256": sha256(out_dir / "actuals_wind.csv"),
            "requestedSettlementDates": [act_start.isoformat(), act_end.isoformat()],
            "startTimeRange": [str(actuals["startTime"].min()), str(actuals["startTime"].max())],
            "rows": len(actuals),
            "missingHalfHours": [str(g) for g in gaps],
        },
        "forecasts": {
            "dataset": "WINDFOR",
            "file": "forecasts_wind.csv",
            "sha256": sha256(out_dir / "forecasts_wind.csv"),
            "requestedPublishWindow": [pub_start.isoformat(), pub_end.isoformat()],
            "publishTimeRange": [str(forecasts["publishTime"].min()), str(forecasts["publishTime"].max())],
            "startTimeRange": [str(forecasts["startTime"].min()), str(forecasts["startTime"].max())],
            "publishTimes": int(forecasts["publishTime"].nunique()),
            "rows": len(forecasts),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nSaved {len(actuals):,} actual rows and {len(forecasts):,} forecast rows to {out_dir}")


if __name__ == "__main__":
    main()
