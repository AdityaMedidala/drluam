"""Load the cached Elexon extracts (written by scripts/fetch_data.py).

January 2026 is historical and fixed, so the app serves a local snapshot instead
of calling Elexon on every request: fast, deterministic, and it keeps working if
the upstream API is slow or down. Re-run the fetch script to refresh.
"""
from __future__ import annotations

import hashlib
import json
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


@lru_cache(maxsize=1)
def load_ml_predictions() -> pd.DataFrame:
    """The optional ML model (LightGBM + CQR, ADR-001), precomputed by `make ml`: scored January hours only."""
    df = pd.read_csv(DATA_DIR / "ml_predictions.csv")
    df = df[df["scored"]].copy()
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    return df.reset_index(drop=True)


@lru_cache(maxsize=1)
def load_ml_development() -> dict:
    """The ML recipe's Nov 2025 - Sep 2026 hit rates and short/long volumes per level (written by `make ml`)."""
    return json.loads((DATA_DIR / "ml_development.json").read_text())


def provenance(data_dir: Path = DATA_DIR) -> dict:
    """Where the snapshot came from, and whether each CSV still matches the sha256 in its manifest."""
    manifest = json.loads((data_dir / "manifest.json").read_text())
    files = []
    for key in ("forecasts", "actuals", "mlPredictions", "mlDevelopment"):
        if key not in manifest:
            continue
        entry = manifest[key]
        actual = hashlib.sha256((data_dir / entry["file"]).read_bytes()).hexdigest()
        files.append({"file": entry["file"], "sha256": entry["sha256"], "verified": actual == entry["sha256"]})
    return {
        "source": manifest["source"],
        "datasets": [manifest["forecasts"]["dataset"], manifest["actuals"]["dataset"]],
        "fetchedAt": manifest["fetchedAt"],
        "files": files,
        "allVerified": all(f["verified"] for f in files),
    }
