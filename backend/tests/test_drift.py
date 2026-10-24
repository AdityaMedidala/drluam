"""Forecast drift: every WINDFOR run for one delivery day, up to the decision cutoff."""
from datetime import date, time

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.analysis import forecast_runs
from app.main import app

client = TestClient(app)


def _forecasts():
    # Runs at 06:00 and 18:00 UTC on 8 and 9 Jan, all covering 10 Jan; GMT, so UK = UTC.
    target = pd.date_range("2026-01-10T00:00", periods=24, freq="1h", tz="UTC")
    rows = []
    for i, pub in enumerate(["2026-01-08T06:00Z", "2026-01-08T18:00Z", "2026-01-09T06:00Z", "2026-01-09T18:00Z"]):
        rows += [{"publishTime": pd.Timestamp(pub), "startTime": t, "generation": 1000.0 * (i + 1)} for t in target]
    return pd.DataFrame(rows)


def test_runs_stop_at_the_cutoff_and_cover_only_that_day():
    runs = forecast_runs(_forecasts(), date(2026, 1, 10), time(9, 20))
    assert sorted(runs["publishTime"].unique()) == [pd.Timestamp("2026-01-08T06:00Z"), pd.Timestamp("2026-01-08T18:00Z"),
                                                    pd.Timestamp("2026-01-09T06:00Z")]
    assert (runs["startTime"].dt.date == date(2026, 1, 10)).all()


def test_last_run_is_the_decision_forecast():
    runs = forecast_runs(_forecasts(), date(2026, 1, 10), time(9, 20))
    last = runs[runs["publishTime"] == runs["publishTime"].max()]
    assert (last["forecast"] == 3000.0).all() and len(last) == 24


def test_drift_route_matches_the_day_route():
    drift = client.get("/api/drift", params={"date": "2026-01-15"}).json()
    day = client.get("/api/day", params={"date": "2026-01-15"}).json()
    runs = drift["runs"]
    assert drift["cutoff"] == "09:20" and len(runs) >= 2
    assert [r["publishedUtc"] for r in runs] == sorted(r["publishedUtc"] for r in runs)
    assert all(r["publishedUtc"] <= day["decisionTimeUtc"] for r in runs)
    decision = runs[-1]
    assert decision["isDecisionRun"] and not any(r["isDecisionRun"] for r in runs[:-1])
    assert decision["publishedUtc"] == day["forecastPublishedUtc"]
    on_the_hour = {p["time"]: p["forecast"] for p in day["series"] if p["forecast"] is not None}
    assert {h["time"]: h["forecastMW"] for h in decision["hours"]} == on_the_hour
    assert decision["dayMWh"] == pytest.approx(day["summary"]["forecastEnergyMWh"])


def test_drift_route_rejects_out_of_scope_dates():
    assert client.get("/api/drift", params={"date": "2026-03-01"}).status_code == 400


def test_drift_compares_runs_on_the_hours_they_all_cover():
    drift = client.get("/api/drift", params={"date": "2026-01-15"}).json()
    common = set.intersection(*({h["time"] for h in r["hours"]} for r in drift["runs"]))
    assert drift["commonHours"] == len(common) == 22   # D-2 runs stop short of the last two hours
    for r in drift["runs"]:
        expected = sum(h["forecastMW"] for h in r["hours"] if h["time"] in common)
        assert r["commonMWh"] == pytest.approx(expected)
