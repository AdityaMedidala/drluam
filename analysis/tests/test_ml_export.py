"""`make ml` must reproduce the ML predictions the app ships (ADR-001).

Needs the analysis data (gitignored) and lightgbm; skipped otherwise. Takes a few minutes.
Run from the repo root: python -m pytest analysis/tests -q
"""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ml_export  # noqa: E402

SHIPPED = ml_export.OUT
HAVE_DATA = all((ml_export.ml.DIRS[n] / "forecasts_wind.csv").exists() for n in ml_export.NAMES)
lightgbm = pytest.importorskip("lightgbm")


@pytest.mark.skipif(not HAVE_DATA, reason="analysis CSVs not present (rebuild with fetch_data.py, see README)")
def test_regenerated_predictions_match_the_shipped_file():
    shipped = pd.read_csv(SHIPPED / "ml_predictions.csv")
    fresh = ml_export.predictions()
    fresh = pd.read_csv(pd.io.common.StringIO(fresh.to_csv(index=False)))   # same parsing as the shipped file
    assert list(fresh.columns) == list(shipped.columns)
    assert len(fresh) == len(shipped)
    pd.testing.assert_frame_equal(fresh, shipped, check_exact=False, atol=0.11, rtol=0)


@pytest.mark.skipif(not HAVE_DATA, reason="analysis CSVs not present (rebuild with fetch_data.py, see README)")
def test_regenerated_development_summary_matches_the_shipped_file():
    shipped = json.loads((SHIPPED / "ml_development.json").read_text())
    fresh = ml_export.development()
    assert fresh["hours"] == shipped["hours"]
    for c, v in shipped["hitRates"].items():
        assert fresh["hitRates"][c] == pytest.approx(v, abs=2e-4)
    for c, (s, lg) in shipped["volumesMWh"].items():
        assert fresh["volumesMWh"][c] == pytest.approx([s, lg], abs=50)
