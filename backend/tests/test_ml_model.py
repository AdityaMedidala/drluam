"""The optional ML model (LightGBM + CQR, ADR-001): served from the precomputed CSV, never computed at runtime."""
import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.analysis import PLAN_CONFIDENCES, UK_TZ
from app.data import DATA_DIR, FIRST_DELIVERY, LAST_DELIVERY
from app.main import app

client = TestClient(app)
CSV = pd.read_csv(DATA_DIR / "ml_predictions.csv", parse_dates=["startTime", "calibrationFrom", "calibrationTo"])
SCORED = CSV[CSV["scored"]].set_index("startTime")


def decision_time(delivery: str) -> pd.Timestamp:
    """09:20 UK on D-1, in UTC."""
    d = pd.Timestamp(delivery) - pd.Timedelta(days=1)
    return (d + pd.Timedelta(hours=9, minutes=20)).tz_localize(UK_TZ).tz_convert("UTC")


def test_every_january_delivery_hour_has_an_ml_prediction():
    days = pd.to_datetime(SCORED["deliveryDate"]).dt.date
    assert days.min() == FIRST_DELIVERY and days.max() == LAST_DELIVERY
    assert len(SCORED) == 744
    assert SCORED[["p10", "p50", "p90", *(f"plan{c}" for c in PLAN_CONFIDENCES)]].notna().all().all()


def test_ml_day_and_plan_values_match_the_csv():
    day = client.get("/api/day", params={"date": "2026-01-17", "model": "ml"}).json()
    hourly = [p for p in day["series"] if p["forecast"] is not None]
    assert len(hourly) == 24
    for p in hourly:
        row = SCORED.loc[pd.Timestamp(p["time"])]
        assert (p["adjusted"], p["low"], p["high"]) == pytest.approx((row["p50"], row["p10"], row["p90"]), abs=1e-6)
    assert day["correctionRatio"] is None            # the ratio belongs to the Simple model
    plan = client.get("/api/plan", params={"date": "2026-01-17", "model": "ml", "confidence": 90}).json()
    for h in plan["hours"]:
        assert h["planMW"] == pytest.approx(SCORED.loc[pd.Timestamp(h["time"]), "plan90"], abs=1e-6)


def test_each_prediction_was_trained_and_calibrated_before_its_decision_time():
    for _, row in SCORED.iterrows():
        cutoff = decision_time(row["deliveryDate"])
        assert pd.Timestamp(row["trainedThrough"]) < pd.Timestamp(row["decisionMonth"] + "-01")   # model saw only earlier months
        assert row["calibrationTo"] <= cutoff                                                     # every calibration outturn known
        assert row["calibrationFrom"] + pd.Timedelta(minutes=30) > cutoff - pd.Timedelta(days=28)   # window is on known-at time
        assert row["calibrationHours"] == 672


def conformal(scores: np.ndarray, coverage: float) -> float:
    k = math.ceil(coverage * (len(scores) + 1))
    return np.sort(scores)[k - 1]


@pytest.mark.parametrize("delivery", ["2026-01-02", "2026-01-17", "2026-02-01"])
def test_cqr_adjustment_recomputes_from_the_csvs_own_raw_rows(delivery):
    # An independent recompute (pure pandas) of the 28-day CQR from the shipped raw quantiles.
    cutoff = decision_time(delivery)
    known = CSV["startTime"] + pd.Timedelta(minutes=30)
    cal = CSV[(known <= cutoff) & (known > cutoff - pd.Timedelta(days=28)) & CSV["actual"].notna()]
    assert len(cal) == 672
    y = cal["actual"].to_numpy()
    q2 = conformal(np.maximum(cal["raw10"] - y, y - cal["raw90"]), 0.80)
    day = SCORED[SCORED["deliveryDate"] == delivery]
    assert np.allclose(day["p90"], day["raw90"] + q2, atol=0.25)
    assert np.allclose(day["p10"], (day["raw10"] - q2).clip(lower=0), atol=0.25)
    for c in PLAN_CONFIDENCES:
        raw = f"raw{100 - c:02d}"
        q = conformal(cal[raw].to_numpy() - y, c / 100)
        assert np.allclose(day[f"plan{c}"], (day[raw] - q).clip(lower=0), atol=0.25)


ROUTES = [("/api/accuracy", {}), ("/api/cost", {}), ("/api/day", {"date": "2026-01-17"}), ("/api/plan", {"date": "2026-01-17"})]


def test_simple_is_the_default_and_unchanged():
    for path, params in ROUTES:
        assert client.get(path, params=params).json() == client.get(path, params={**params, "model": "simple"}).json()


def test_ml_response_shapes_match_simple():
    for path, params in ROUTES:
        a = client.get(path, params=params).json()
        b = client.get(path, params={**params, "model": "ml"}).json()
        assert set(a) == set(b), path


@pytest.mark.parametrize("params", [{"model": "neural"}, {"model": "ml", "cutoff": "08:00"}])
def test_ml_model_validation(params):
    assert client.get("/api/accuracy", params=params).status_code == 422


def test_ml_is_served_at_both_decision_times_it_covers():
    a = client.get("/api/accuracy", params={"model": "ml", "cutoff": "09:00"}).json()
    b = client.get("/api/accuracy", params={"model": "ml", "cutoff": "09:20"}).json()
    assert a["comparison"]["adjusted"] == b["comparison"]["adjusted"]   # no WINDFOR run between 09:00 and 09:20


# Golden January numbers for both models (09:20, 744 hours). Simple's are also pinned against the README in test_golden.py.
GOLDEN = {
    "simple": {"mae": 1382.57, "bias": 319.51, "coverage": 0.6909, "p90hit": 0.8212, "p80costGBP": 76_312_913, "lowest": "P70"},
    "ml":     {"mae": 1318.42, "bias": 463.58, "coverage": 0.7661, "p90hit": 0.8481, "p80costGBP": 53_082_626, "lowest": "P80"},
}


@pytest.mark.parametrize("model", list(GOLDEN))
def test_golden_january_numbers(model):
    g = GOLDEN[model]
    acc = client.get("/api/accuracy", params={"model": model}).json()
    cost = client.get("/api/cost", params={"model": model}).json()
    adj = acc["comparison"]["adjusted"]
    assert adj["n"] == 744
    assert adj["mae"] == pytest.approx(g["mae"], abs=0.01)
    assert adj["bias"] == pytest.approx(g["bias"], abs=0.01)
    assert acc["band"]["coverage"] == pytest.approx(g["coverage"], abs=1e-4)
    assert next(r for r in acc["planCalibration"] if r["confidence"] == 90)["januaryHitRate"] == pytest.approx(g["p90hit"], abs=1e-4)
    p80 = next(r for r in cost["backtest"]["rows"] if r["key"] == "P80")
    assert p80["costGBP"] == pytest.approx(g["p80costGBP"], abs=1)
    assert cost["backtest"]["lowest"] == g["lowest"]
