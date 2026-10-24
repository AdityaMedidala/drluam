"""Cost-aware exceedance level: the newsvendor rule and the cost backtest."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.analysis import PLAN_CONFIDENCES, cost_backtest, plan_cost, recommended_level
from app.main import app

client = TestClient(app)


def test_cost_by_hand():
    # Hour 1: planned 100, outturn 80 -> 20 MWh short x £100 = £2,000.
    # Hour 2: planned 50, outturn 70 -> 20 MWh long x £30 = £600.
    cost = plan_cost(pd.Series([100.0, 50.0]), pd.Series([80.0, 70.0]), short=100, long=30)
    assert cost.tolist() == [2000.0, 600.0]


def test_cost_is_zero_when_the_plan_matches_the_outturn():
    assert plan_cost(pd.Series([10.0, 0.0]), pd.Series([10.0, 0.0]), short=100, long=30).sum() == 0


def test_quantile_identity_on_synthetic_data():
    # The constant plan that minimises total cost is exceeded by the outturn in a
    # share short / (short + long) of hours: the newsvendor critical ratio.
    rng = np.random.default_rng(0)
    outturn = pd.Series(rng.gamma(4.0, 2500.0, 20_000))
    candidates = np.sort(outturn.to_numpy())[::20]
    for short, long in [(100, 30), (50, 50), (30, 100), (400, 20)]:
        totals = [plan_cost(pd.Series(q, index=outturn.index), outturn, short, long).sum() for q in candidates]
        best = candidates[int(np.argmin(totals))]
        exceeded = (outturn >= best).mean()
        assert exceeded == pytest.approx(short / (short + long), abs=0.005)


def test_recommended_level_for_the_defaults():
    r = recommended_level(short=100, long=30)
    assert r["exact"] == pytest.approx(100 * 100 / 130)    # 76.9, shown as P77
    assert r["level"] == 80
    assert r["snapped"] is False


def test_recommended_level_is_monotonic_in_the_cost_ratio():
    ratios = np.linspace(0.05, 50, 400)
    recs = [recommended_level(short=r, long=1.0) for r in ratios]
    exact = [x["exact"] for x in recs]
    levels = [x["level"] for x in recs]
    assert all(a < b for a, b in zip(exact, exact[1:]))
    assert all(a <= b for a, b in zip(levels, levels[1:]))
    assert set(levels) == set(PLAN_CONFIDENCES)


def test_recommended_level_below_p50_snaps_to_p50():
    r = recommended_level(short=20, long=80)
    assert r["exact"] == pytest.approx(20)
    assert r["level"] == 50
    assert r["snapped"] is True


def test_recommended_level_ties_go_to_the_higher_level():
    assert recommended_level(short=3, long=1)["level"] == 80   # exactly P75, halfway between P70 and P80


@pytest.mark.parametrize("short,long", [(0, 30), (100, 0), (-1, 30)])
def test_recommended_level_needs_positive_costs(short, long):
    with pytest.raises(ValueError):
        recommended_level(short=short, long=long)


def test_cost_backtest_scores_every_row_on_the_same_hours():
    frame = pd.DataFrame({
        "actual": [80.0, 70.0, np.nan],
        "forecast": [120.0, 60.0, 50.0],
        "adjusted": [100.0, 50.0, 40.0],
        **{f"plan{c}": [100.0 - c / 10, 50.0 - c / 10, 30.0] for c in PLAN_CONFIDENCES},
    })
    bt = cost_backtest(frame, short=100, long=30)
    assert bt["hours"] == 2                                     # the hour with no outturn is dropped for every row
    rows = {r["key"]: r for r in bt["rows"]}
    assert list(rows) == [*(f"P{c}" for c in PLAN_CONFIDENCES), "forecast", "adjusted"]
    assert rows["forecast"]["costGBP"] == 100 * 40 + 30 * 10    # 40 MWh short, then 10 MWh long
    assert rows["adjusted"]["costGBP"] == 100 * 20 + 30 * 20
    assert rows["forecast"]["vsNesoGBP"] == 0
    assert rows["adjusted"]["vsNesoGBP"] == rows["adjusted"]["costGBP"] - rows["forecast"]["costGBP"]
    lowest = min(bt["rows"], key=lambda r: r["costGBP"])
    assert bt["lowest"] == lowest["key"]
    best_level = min((r for r in bt["rows"] if r["confidence"]), key=lambda r: r["costGBP"])
    assert bt["bestLevel"] == best_level["confidence"]


def test_cost_route_defaults():
    r = client.get("/api/cost")
    assert r.status_code == 200
    body = r.json()
    assert (body["short"], body["long"], body["cutoff"]) == (100, 30, "09:20")
    assert body["recommended"]["level"] == 80
    assert body["backtest"]["hours"] == 744                     # every January hour at 09:20 has a full week of residuals
    assert [row["key"] for row in body["backtest"]["rows"]][-2:] == ["forecast", "adjusted"]


def test_cost_route_matches_a_recompute_from_the_decision_frame():
    from app.main import scoped_frame
    body = client.get("/api/cost", params={"short": 60, "long": 40, "cutoff": "09:50"}).json()
    jan = scoped_frame("09:50").dropna(subset=["actual", "forecast", "adjusted", *(f"plan{c}" for c in PLAN_CONFIDENCES)])
    expected = plan_cost(jan["plan80"], jan["actual"], 60, 40).sum()
    row = next(r for r in body["backtest"]["rows"] if r["key"] == "P80")
    assert row["costGBP"] == pytest.approx(expected, rel=1e-6)


@pytest.mark.parametrize("params", [{"short": 0}, {"long": -5}, {"short": "abc"}])
def test_cost_route_rejects_bad_costs(params):
    assert client.get("/api/cost", params=params).status_code == 422
