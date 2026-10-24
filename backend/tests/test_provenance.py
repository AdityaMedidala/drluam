"""Data provenance: where the snapshot came from, and whether its checksums still match."""
import json
import shutil

from fastapi.testclient import TestClient

from app.data import DATA_DIR, provenance
from app.main import app


def test_route_reports_source_fetch_time_and_verified_checksums():
    body = TestClient(app).get("/api/provenance").json()
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())
    assert body["fetchedAt"] == manifest["fetchedAt"]
    assert body["datasets"] == ["WINDFOR", "FUELHH (fuelType=WIND)"]
    assert body["allVerified"] is True
    assert {f["file"] for f in body["files"]} == {"actuals_wind.csv", "forecasts_wind.csv"}


def test_a_changed_csv_fails_verification(tmp_path):
    for name in ("manifest.json", "actuals_wind.csv", "forecasts_wind.csv"):
        shutil.copy(DATA_DIR / name, tmp_path / name)
    with open(tmp_path / "actuals_wind.csv", "a") as f:
        f.write("tampered\n")
    p = provenance(tmp_path)
    assert p["allVerified"] is False
    assert {f["file"]: f["verified"] for f in p["files"]} == {"actuals_wind.csv": False, "forecasts_wind.csv": True}
