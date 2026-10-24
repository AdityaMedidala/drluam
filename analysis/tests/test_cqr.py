"""Conformal pieces and the leakage guard for analysis/cqr.py (rule in docs/cqr.md).

Run from the repo root: python -m pytest analysis/tests -q
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cqr  # noqa: E402
import ml_challenger as ml  # noqa: E402


def test_conformal_quantile_is_the_ceil_rank_order_statistic():
    scores = np.arange(1.0, 10.0)                       # n = 9
    assert cqr.conformal_quantile(scores, 0.80) == 8.0  # ceil(0.8 x 10) = 8th smallest
    assert cqr.conformal_quantile(scores, 0.95) == float("inf")   # ceil(0.95 x 10) = 10 > n


def test_two_sided_cqr_restores_coverage_on_exchangeable_data():
    rng = np.random.default_rng(0)
    cal, test = rng.normal(0, 1, 2000), rng.normal(0, 1, 20000)
    lo, hi = -0.5, 0.5                                   # far too narrow: ~38% coverage
    q = cqr.conformal_quantile(np.maximum(lo - cal, cal - hi), 0.80)
    covered = ((test >= lo - q) & (test <= hi + q)).mean()
    assert covered == pytest.approx(0.80, abs=0.02)


def synthetic_oos(hours: int = 24 * 40) -> pd.DataFrame:
    start = pd.Timestamp("2026-01-01", tz="UTC")
    t = pd.date_range(start, periods=hours, freq="h")
    df = pd.DataFrame({"startTime": t, "actual": 5000.0, "deliveryDate": t.date})
    df.loc[df.index % 50 == 0, "actual"] = np.nan
    df["month"] = cqr.decision_month(pd.Series(df["deliveryDate"]))
    df["trainedThrough"] = pd.to_datetime(df["month"] + "-01") - pd.Timedelta(days=1)
    for a in ml.ALPHAS:
        df[ml.CHAL[a]] = 5000.0 + (a - 0.5) * 1000
    return df


def test_no_calibration_row_has_outturn_later_than_the_decision_it_serves():
    oos = synthetic_oos()
    for cutoff in pd.date_range("2026-01-20 09:20", periods=15, freq="D", tz="UTC"):
        cal = cqr.calibration_rows(oos, cutoff)
        known_at = cal["startTime"] + pd.Timedelta(minutes=30)
        assert (known_at <= cutoff).all()
        assert (known_at > cutoff - pd.Timedelta(days=28)).all()
        assert cal["actual"].notna().all()
        assert len(cal) > 0


def test_adjustments_refuse_a_prediction_from_a_model_trained_into_its_own_month():
    oos = synthetic_oos()
    oos.loc[oos.index[-1], "trainedThrough"] = pd.Timestamp("2026-12-31")
    oos.loc[oos.index[-1], "startTime"] = pd.Timestamp("2026-02-05 00:00", tz="UTC")
    days = pd.Series({pd.Timestamp("2026-02-07").date(): pd.Timestamp("2026-02-06 09:20", tz="UTC")})
    with pytest.raises(AssertionError):
        cqr.adjustments(oos, days)
