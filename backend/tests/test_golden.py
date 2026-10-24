"""Golden numbers: the README headline figures, recomputed from the snapshot.

If the data or the method changes, this fails until the README is updated to
match (and these constants with it), so the write-up can't drift from the code.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

README = (Path(__file__).resolve().parents[2] / "README.md").read_text()


def mw(v):
    return f"{v:+,.0f} MW"


def pct(v):
    return f"{v:.0%}"


@pytest.fixture(scope="module")
def acc():
    return TestClient(app).get("/api/accuracy", params={"cutoff": "09:00"}).json()


def headline(acc):
    raw, adj = acc["comparison"]["raw"], acc["comparison"]["adjusted"]
    return {
        "raw MAE": f"{raw['mae']:,.0f} MW",
        "adjusted MAE": f"{adj['mae']:,.0f} MW",
        "MAE cut": f"−{1 - adj['mae'] / raw['mae']:.0%}",
        "raw bias": mw(raw["bias"]),
        "adjusted bias": mw(adj["bias"]),
        "bias removed": f"~{1 - adj['bias'] / raw['bias']:.0%} removed",
        "raw nMAE": f"{raw['nmae']:.1%}",
        "adjusted nMAE": f"{adj['nmae']:.1%}",
        "hours over-forecast": f"too high in {pct(acc['raw']['overForecastShare'])} of hours",
        "hours compared": f"same {adj['n']} hours ({acc['comparison']['days']} delivery days",
        "days beaten": f"beat the raw forecast on {acc['comparison']['daysAdjustedBetter']} of {acc['comparison']['days']} days",
        "band coverage": f"inside it in {pct(acc['band']['coverage'])} of hours",
    }


GOLDEN = {
    "raw MAE": "2,022 MW",
    "adjusted MAE": "1,383 MW",
    "MAE cut": "−32%",
    "raw bias": "+1,746 MW",
    "adjusted bias": "+320 MW",
    "bias removed": "~82% removed",
    "raw nMAE": "17.9%",
    "adjusted nMAE": "12.2%",
    "hours over-forecast": "too high in 85% of hours",
    "hours compared": "same 744 hours (31 delivery days",
    "days beaten": "beat the raw forecast on 22 of 31 days",
    "band coverage": "inside it in 69% of hours",
}


def test_api_matches_golden_numbers(acc):
    assert headline(acc) == GOLDEN


@pytest.mark.parametrize("name", GOLDEN)
def test_readme_states_golden_number(name):
    assert GOLDEN[name] in README, f"README is missing {name}: {GOLDEN[name]!r}"
