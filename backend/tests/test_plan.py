"""The 'plan on' number: wind we expect to see at least, with C% confidence."""
from datetime import time
from pathlib import Path

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


def test_plan_route_reports_every_levels_target_and_hit_rates():
    cal = client.get("/api/plan", params={"date": "2026-01-15"}).json()["calibration"]
    assert [r["confidence"] for r in cal] == list(PLAN_CONFIDENCES)
    jan = {r["confidence"]: r["januaryHitRate"] for r in cal}
    for c in PLAN_CONFIDENCES:
        alone = client.get("/api/plan", params={"date": "2026-01-15", "confidence": c}).json()
        assert jan[c] == alone["backtest"]["hitRate"]
    # Pooled Nov 2025 - Sep 2026 from docs/plan-backtest.md, valid at 09:00/09:20 only.
    assert {r["confidence"]: r["developmentHitRate"] for r in cal}[90] == 0.8397
    other = client.get("/api/plan", params={"date": "2026-01-15", "cutoff": "06:00"}).json()["calibration"]
    assert all(r["developmentHitRate"] is None for r in other)


def test_accuracy_carries_the_plan_calibration():
    acc = client.get("/api/accuracy").json()["planCalibration"]
    plan = client.get("/api/plan", params={"date": "2026-01-15"}).json()["calibration"]
    assert acc == plan


ANALYSIS = Path(__file__).resolve().parents[2] / "analysis"
DEV_DIRS = [ANALYSIS / "data", ANALYSIS / "data-2026-04-09"]


@pytest.mark.skipif(not all((d / "forecasts_wind.csv").exists() for d in DEV_DIRS),
                    reason="analysis CSVs not present (rebuild with fetch_data.py, see README)")
def test_dev_hit_rate_constants_match_a_recompute():
    from app.main import DEV_PLAN_HIT_RATES
    scored = dev_scored_frame()
    assert plan_hit_rate(scored, 50)["n"] == 7775
    for c in PLAN_CONFIDENCES:
        assert plan_hit_rate(scored, c)["hitRate"] == pytest.approx(DEV_PLAN_HIT_RATES[c], abs=5e-5)


@pytest.mark.skipif(not all((d / "forecasts_wind.csv").exists() for d in DEV_DIRS),
                    reason="analysis CSVs not present (rebuild with fetch_data.py, see README)")
def test_dev_cost_volume_constants_match_a_recompute():
    from app.analysis import plan_volumes
    from app.main import DEV_PLAN_VOLUMES
    volumes = plan_volumes(dev_scored_frame())
    assert volumes["hours"] == 7775
    for c in PLAN_CONFIDENCES:
        assert volumes["levels"][c] == pytest.approx(DEV_PLAN_VOLUMES[c], abs=1)


def dev_scored_frame() -> pd.DataFrame:
    """Same data and rules as analysis/plan_backtest.py: nothing before 1 Nov 2025,
    decision month = D-1 in Nov 2025 - Sep 2026, only hours with 168 residuals."""
    start = pd.Timestamp("2025-11-01", tz="UTC")
    acts, fcs = [], []
    for d in DEV_DIRS:
        a = pd.read_csv(d / "actuals_wind.csv", parse_dates=["startTime"])
        f = pd.read_csv(d / "forecasts_wind.csv", parse_dates=["publishTime", "startTime"])
        acts.append(a[["startTime", "generation"]])
        fcs.append(f)
    actuals = pd.concat(acts).drop_duplicates("startTime", keep="last")
    forecasts = pd.concat(fcs).drop_duplicates(["publishTime", "startTime"], keep="last")
    actuals = actuals[actuals["startTime"] >= start].sort_values("startTime").reset_index(drop=True)
    forecasts = forecasts[forecasts["publishTime"] >= start].reset_index(drop=True)

    frame = build_decision_frame(forecasts, actuals, time(9, 20))
    month = (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    return frame[(frame["bandPoints"] == 168) & (month >= "2025-11") & (month <= "2026-09")]
