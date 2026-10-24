"""Leakage guards for analysis/ml_challenger.py (pre-registered in docs/ml-challenger.md).

Run from the repo root: python -m pytest analysis/tests -q
"""
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ml_challenger as ml  # noqa: E402

FEATURES = ml.FEATURES


def synthetic(days: int = 24, seed: int = 0):
    """Runs every 3 h, each covering the next 48 h hourly; half-hourly outturn."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2025-01-01", tz="UTC")
    runs = pd.date_range(start, periods=days * 8, freq="3h")
    rows = [(p, p + pd.Timedelta(hours=h), 8000 + 3000 * np.sin(h / 7) + rng.normal(0, 400))
            for p in runs for h in range(1, 49)]
    forecasts = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    halfs = pd.date_range(start, periods=(days + 2) * 48, freq="30min")
    actuals = pd.DataFrame({"startTime": halfs, "generation": 7000 + 2500 * np.sin(np.arange(len(halfs)) / 14)
                            + rng.normal(0, 600, len(halfs))})
    return forecasts, actuals


def test_every_feature_row_uses_only_information_from_before_its_decision_time():
    f = ml.build_features(*synthetic())
    assert f["latestInfoUtc"].notna().all()
    assert (f["latestInfoUtc"] <= f["cutoffUtc"]).all()
    assert (f["publishTime"] <= f["cutoffUtc"]).all()
    assert (f["prevPublish"].dropna() < f.loc[f["prevPublish"].notna(), "publishTime"]).all()


def test_scrambling_everything_after_a_decision_leaves_that_days_features_unchanged():
    forecasts, actuals = synthetic()
    base = ml.build_features(forecasts, actuals)
    day = date(2025, 1, 15)
    cutoff = base.loc[base["deliveryDate"] == day, "cutoffUtc"].iloc[0]
    rng = np.random.default_rng(1)
    late_f = forecasts["publishTime"] > cutoff
    late_a = actuals["startTime"] + pd.Timedelta(minutes=30) > cutoff
    forecasts.loc[late_f, "generation"] = rng.uniform(0, 20000, late_f.sum())
    actuals.loc[late_a, "generation"] = rng.uniform(0, 20000, late_a.sum())
    again = ml.build_features(forecasts, actuals)
    a = base[base["deliveryDate"] == day][FEATURES].reset_index(drop=True)
    b = again[again["deliveryDate"] == day][FEATURES].reset_index(drop=True)
    pd.testing.assert_frame_equal(a, b)


def test_training_rows_end_before_the_first_decision_of_the_month():
    f = ml.build_features(*synthetic())
    first = date(2025, 1, 20)
    train = ml.training_rows(f, first)
    assert len(train) > 0
    assert train["deliveryDate"].max() < first
    end_of_targets = train["startTime"].max() + pd.Timedelta(hours=1)
    first_cutoff = f.loc[f["deliveryDate"] == first + pd.Timedelta(days=1), "cutoffUtc"].iloc[0]
    assert end_of_targets <= first_cutoff
    assert train["deliveryDate"].min() >= ml.TRAIN_START


def test_pinball_by_hand():
    y = np.array([10.0, 10.0])
    assert ml.pinball(np.array([8.0, 12.0]), y, 0.9).tolist() == pytest.approx([1.8, 0.2])


HAVE_DATA = all((ml.DIRS[n] / "forecasts_wind.csv").exists() for n in ("vault-2025", "data", "data-2026-04-09"))


@pytest.mark.skipif(not HAVE_DATA, reason="analysis CSVs not present (rebuild with fetch_data.py, see README)")
def test_real_feature_rows_use_only_information_from_before_their_decision_time():
    f = ml.build_features(*ml.load(["vault-2025", "data", "data-2026-04-09"]))
    assert (f["latestInfoUtc"] <= f["cutoffUtc"]).all()
