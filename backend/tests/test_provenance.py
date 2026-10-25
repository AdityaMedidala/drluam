"""Data provenance: where the snapshot came from, and whether its checksums still match."""
import json
import shutil

from fastapi.testclient import TestClient

import pytest

from app.data import DATA_DIR, provenance
from app.main import app

# The Elexon snapshot plus the precomputed ML model's files (ADR-001).
FILES = ("actuals_wind.csv", "forecasts_wind.csv", "ml_predictions.csv", "ml_development.json")


def test_route_reports_source_fetch_time_and_verified_checksums():
    body = TestClient(app).get("/api/provenance").json()
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())
    assert body["fetchedAt"] == manifest["fetchedAt"]
    assert body["datasets"] == ["WINDFOR", "FUELHH (fuelType=WIND)"]
    assert body["allVerified"] is True
    assert {f["file"] for f in body["files"]} == set(FILES)


@pytest.mark.parametrize("tampered", FILES)
def test_a_changed_file_fails_verification(tmp_path, tampered):
    for name in ("manifest.json", *FILES):
        shutil.copy(DATA_DIR / name, tmp_path / name)
    with open(tmp_path / tampered, "a") as f:
        f.write("tampered\n")
    p = provenance(tmp_path)
    assert p["allVerified"] is False
    assert {f["file"]: f["verified"] for f in p["files"]} == {name: name != tampered for name in FILES}
