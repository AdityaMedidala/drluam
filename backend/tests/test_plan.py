"""The 'plan on' number: wind we expect to see at least, with C% confidence."""
from datetime import time

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.analysis import PLAN_CONFIDENCES, build_decision_frame, plan_hit_rate
from app.main import app

client = TestClient(app)


def _noisy(days=20, seed=0):
    rng = np.random.default_rng(seed)
    times = pd.date_range("2026-01-01T00:00", periods=days * 24, freq="1h", tz="UTC")
    fc = rng.uniform(5_000, 15_000, len(times))
    act = fc * rng.uniform(0.6, 1.1, len(times))
    forecasts = pd.DataFrame({"publishTime": times - pd.Timedelta(hours=48), "startTime": times, "generation": fc})
    actuals = pd.DataFrame({"startTime": times, "generation": act})
    return forecasts, actuals


def test_plan_is_adjusted_plus_lower_residual_quantile():
    forecasts, actuals = _noisy()
    frame = build_decision_frame(forecasts, actuals, time(9, 0))
    row = frame[frame.startTime == pd.Timestamp("2026-01-18T12:00Z")].iloc[0]
    # The P10 band edge is the 90%-confidence plan, by construction.
    assert row.plan90 == pytest.approx(max(0.0, row.low))


def test_plan_falls_as_confidence_rises():
    frame = build_decision_frame(*_noisy(), time(9, 0)).dropna(subset=["plan50"])
    cols = [f"plan{c}" for c in PLAN_CONFIDENCES]
    assert len(frame) > 0
    assert (frame[cols].diff(axis=1).iloc[:, 1:] <= 0).all().all()


def test_plan_is_never_negative():
    forecasts, actuals = _noisy()
    actuals["generation"] = actuals["generation"] * 0.01   # residuals far below the forecast
    frame = build_decision_frame(forecasts, actuals, time(9, 0)).dropna(subset=["plan95"])
    assert (frame["plan95"] >= 0).all()


def test_plan_ignores_actuals_after_the_cutoff():
    forecasts, actuals = _noisy()
    before = build_decision_frame(forecasts, actuals, time(9, 0))
    target = pd.Timestamp("2026-01-18").date()
    cutoff_utc = pd.Timestamp("2026-01-17T09:00Z")
    late = actuals["startTime"] + pd.Timedelta(minutes=30) > cutoff_utc
    actuals.loc[late, "generation"] = 0.0
    after = build_decision_frame(forecasts, actuals, time(9, 0))
    cols = [f"plan{c}" for c in PLAN_CONFIDENCES]
    pd.testing.assert_frame_equal(before.loc[before.deliveryDate == target, cols],
                                  after.loc[after.deliveryDate == target, cols])


def test_hit_rate_by_hand():
    f = pd.DataFrame({"actual": [5.0, 10.0, 3.0, 8.0, np.nan], "plan80": [4.0, 10.0, 4.0, 9.0, 1.0]})
    # 5>=4 hit, 10>=10 hit, 3<4 miss, 8<9 miss; the NaN actual is not counted.
    assert plan_hit_rate(f, 80) == {"n": 4, "hitRate": 0.5, "target": 0.8}


def test_plan_route():
    bodies = {c: client.get("/api/plan", params={"date": "2026-01-15", "confidence": c}).json()
              for c in PLAN_CONFIDENCES}
    b80 = bodies[80]
    assert b80["cutoff"] == "09:20" and b80["confidence"] == 80
    assert len(b80["hours"]) == 24
    assert b80["day"]["planMWh"] == pytest.approx(sum(h["planMW"] for h in b80["hours"]), abs=0.1)
    assert b80["day"]["extraToProcureMWh"] == pytest.approx(b80["day"]["rawForecastMWh"] - b80["day"]["planMWh"], abs=0.1)
    assert 0 < b80["backtest"]["hitRate"] < 1 and b80["backtest"]["n"] == 744
    totals = [bodies[c]["day"]["planMWh"] for c in PLAN_CONFIDENCES]
    assert totals == sorted(totals, reverse=True)


@pytest.mark.parametrize("confidence", [0, 60, 99, "high"])
def test_plan_route_rejects_other_confidences(confidence):
    r = client.get("/api/plan", params={"date": "2026-01-15", "confidence": confidence})
    assert r.status_code == 422
