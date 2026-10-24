"""Smoke tests against the real January snapshot in data/."""
import pytest
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
    assert body["historyPoints"] == body["historyPointsFull"] == 168


def test_day_rejects_out_of_scope_date():
    assert client.get("/api/day", params={"date": "2026-03-01"}).status_code == 400


@pytest.mark.parametrize("cutoff", ["09:20", "09:50"])
def test_auction_gate_closures_are_offered(cutoff):
    # GB day-ahead auctions close ~09:20 (EPEX) and ~09:50 (N2EX) UK time.
    assert cutoff in client.get("/api/meta").json()["cutoffOptions"]
    r = client.get("/api/day", params={"date": "2026-01-15", "cutoff": cutoff})
    assert r.status_code == 200
    assert r.json()["decisionTimeUtc"] == f"2026-01-14T{cutoff}:00Z"


@pytest.mark.parametrize("cutoff", ["nine", "09:15", "25:00"])
def test_cutoff_outside_options_is_422(cutoff):
    assert client.get("/api/accuracy", params={"cutoff": cutoff}).status_code == 422
    assert client.get("/api/day", params={"date": "2026-01-15", "cutoff": cutoff}).status_code == 422


def test_equivalent_cutoffs_share_one_cache_entry():
    from app.main import decision_frame
    decision_frame.cache_clear()
    a = client.get("/api/accuracy", params={"cutoff": "09:00"}).json()
    b = client.get("/api/accuracy", params={"cutoff": "09:00:00"}).json()
    assert a == b and b["cutoff"] == "09:00"
    assert decision_frame.cache_info().currsize == 1


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


def test_health_reports_loaded_data():
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["actualRows"] > 0 and body["forecastRows"] > 0


def test_health_is_503_when_data_cannot_load(monkeypatch):
    import app.main as main

    def broken():
        raise FileNotFoundError("actuals_wind.csv")

    monkeypatch.setattr(main, "load_actuals", broken)
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["status"] == "error"


def test_startup_loads_data():
    from app.data import load_actuals, load_forecasts
    load_actuals.cache_clear(); load_forecasts.cache_clear()
    with TestClient(app):  # runs the lifespan startup
        assert load_actuals.cache_info().currsize == 1 and load_forecasts.cache_info().currsize == 1


def test_clean_maps_nat_and_inf_to_null():
    import json

    import numpy as np
    import pandas as pd

    from app.main import clean
    out = clean({"nat": pd.NaT, "inf": float("inf"), "ninf": np.float64(-np.inf), "nan": np.nan,
                 "ts": pd.Timestamp("2026-01-02T00:00Z"), "n": [np.int64(3), 1.23456]})
    assert out == {"nat": None, "inf": None, "ninf": None, "nan": None, "ts": "2026-01-02T00:00:00Z", "n": [3, 1.2346]}
    json.dumps(out, allow_nan=False)  # strictly valid JSON
