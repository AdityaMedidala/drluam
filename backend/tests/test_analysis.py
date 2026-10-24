from datetime import time

import pandas as pd

from app.analysis import select_decision_forecast


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def make(rows):
    return pd.DataFrame(
        [{"publishTime": ts(p), "startTime": ts(s), "generation": g} for p, s, g in rows]
    )


def test_picks_latest_forecast_before_cutoff():
    f = make([
        ("2026-01-09T06:00Z", "2026-01-10T12:00Z", 100),
        ("2026-01-09T08:30Z", "2026-01-10T12:00Z", 200),  # latest before 09:00 -> chosen
    ])
    out = select_decision_forecast(f, time(9, 0))
    assert out.forecast.tolist() == [200]


def test_ignores_forecast_published_after_cutoff():
    f = make([
        ("2026-01-09T08:00Z", "2026-01-10T12:00Z", 100),
        ("2026-01-09T09:30Z", "2026-01-10T12:00Z", 999),  # too late for the auction
        ("2026-01-10T06:00Z", "2026-01-10T12:00Z", 999),  # same-day forecast, too late
    ])
    out = select_decision_forecast(f, time(9, 0))
    assert out.forecast.tolist() == [100]


def test_forecast_exactly_at_cutoff_counts():
    f = make([("2026-01-09T09:00Z", "2026-01-10T00:00Z", 50)])
    out = select_decision_forecast(f, time(9, 0))
    assert out.forecast.tolist() == [50]
    assert out.horizonHours.tolist() == [15.0]


def test_target_with_no_eligible_forecast_is_dropped():
    f = make([("2026-01-09T10:00Z", "2026-01-10T12:00Z", 100)])
    assert select_decision_forecast(f, time(9, 0)).empty


def test_uses_uk_local_time_in_summer():
    # In BST, a 09:00 UK cutoff is 08:00 UTC, so an 08:30 UTC forecast is too late.
    f = make([
        ("2026-07-09T07:30Z", "2026-07-10T12:00Z", 100),
        ("2026-07-09T08:30Z", "2026-07-10T12:00Z", 999),
    ])
    out = select_decision_forecast(f, time(9, 0))
    assert out.forecast.tolist() == [100]


# ------------------------------------------------------------------ decision frame / correction
from app.analysis import build_decision_frame, error_metrics  # noqa: E402


def _hourly(start, hours):
    return pd.date_range(start, periods=hours, freq="1h", tz="UTC")


def test_correction_uses_only_actuals_known_before_cutoff():
    # Forecast is always 2x the actual for 3 days of history, then on the delivery day
    # the actual jumps. The correction must NOT see the delivery-day actuals.
    times = _hourly("2026-01-07T00:00", 4 * 24)
    actual_vals = [100.0] * (3 * 24) + [10_000.0] * 24
    actuals = pd.DataFrame({"startTime": times, "generation": actual_vals})
    # One forecast per target hour, published well before each D-1 09:00 cutoff.
    forecasts = pd.DataFrame({
        "publishTime": times - pd.Timedelta(hours=30),
        "startTime": times,
        "generation": 200.0,
    })
    frame = build_decision_frame(forecasts, actuals, time(9, 0))
    last_day = frame[frame.deliveryDate == pd.Timestamp("2026-01-10").date()]
    # History up to 09:00 on 9 Jan has actual/forecast = 0.5 -> adjusted = 100, not ~10,000.
    assert last_day.ratio.round(6).unique().tolist() == [0.5]
    assert last_day.adjusted.round(6).unique().tolist() == [100.0]


def test_no_correction_without_enough_history():
    times = _hourly("2026-01-07T00:00", 24)
    actuals = pd.DataFrame({"startTime": times, "generation": 100.0})
    forecasts = pd.DataFrame({"publishTime": times - pd.Timedelta(hours=30), "startTime": times, "generation": 200.0})
    frame = build_decision_frame(forecasts, actuals, time(9, 0))
    assert frame.adjusted.isna().all()


def test_error_metrics_sign_and_values():
    err = pd.Series([100.0, -100.0, 300.0])
    act = pd.Series([1000.0, 1000.0, 1000.0])
    m = error_metrics(err, act)
    assert m["bias"] == 100.0          # forecast too high on average
    assert round(m["mae"], 6) == round(500 / 3, 6)
    assert round(m["nmae"], 6) == round(500 / 3 / 1000, 6)
    assert round(m["overForecastShare"], 6) == round(2 / 3, 6)
