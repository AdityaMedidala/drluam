"""The committed snapshot must match the checksums in its manifest."""
import hashlib
import json
from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@pytest.mark.parametrize("key, csv", [("actuals", "actuals_wind.csv"), ("forecasts", "forecasts_wind.csv")])
def test_snapshot_matches_manifest_checksum(key, csv):
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())
    entry = manifest[key]
    assert entry["file"] == csv
    assert entry["sha256"] == hashlib.sha256((DATA_DIR / csv).read_bytes()).hexdigest()
