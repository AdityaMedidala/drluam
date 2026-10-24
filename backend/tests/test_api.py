"""Smoke tests against the real January snapshot in data/."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta():
    r = client.get("/api/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["firstDelivery"] == "2026-01-02" and body["lastDelivery"] == "2026-02-01"


def test_day_has_full_half_hourly_series():
    r = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "09:00"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["series"]) == 48
    # The forecast used must be published before 09:00 UK on the 14th.
    assert body["forecastPublishedUtc"] <= "2026-01-14T09:00:00Z"
    assert body["decisionTimeUtc"] == "2026-01-14T09:00:00Z"


def test_day_rejects_out_of_scope_date():
    assert client.get("/api/day", params={"date": "2026-03-01"}).status_code == 400


def test_bad_cutoff_is_400():
    assert client.get("/api/accuracy", params={"cutoff": "nine"}).status_code == 400


def test_accuracy_shape():
    body = client.get("/api/accuracy").json()
    assert body["raw"]["n"] > 700
    assert len(body["byHour"]) == 24
    assert body["comparison"]["adjusted"]["mae"] < body["comparison"]["raw"]["mae"]


def test_accuracy_reports_band_coverage():
    band = client.get("/api/accuracy").json()["band"]
    assert band["n"] > 700 and 0 < band["coverage"] < 1
    assert abs(band["coverage"] + band["below"] + band["above"] - 1) < 1e-3
    day = client.get("/api/day", params={"date": "2026-01-15"}).json()
    assert day["bandCoverage"] == band["coverage"]
