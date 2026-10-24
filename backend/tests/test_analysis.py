from datetime import time

import numpy as np
import pandas as pd
import pytest

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


@pytest.mark.parametrize("cutoff", [time(9, 0), time(9, 15)])
def test_correction_uses_only_actuals_known_before_cutoff(cutoff):
    # Forecast is always 200. Every actual already known at the D-1 cutoff is 100
    # (ratio 0.5); every actual not yet known -- the rest of D-1 and all of D -- is
    # 10,000. A FUELHH half-hour is known only once it has ended (startTime + 30 min),
    # so with a 09:15 cutoff the 09:00 hour is NOT known yet.
    times = _hourly("2026-01-01T00:00", 10 * 24)
    cutoff_utc = pd.Timestamp(f"2026-01-09T{cutoff:%H:%M}", tz="UTC")  # GMT in January
    known = times + pd.Timedelta(minutes=30) <= cutoff_utc
    actuals = pd.DataFrame({"startTime": times, "generation": [100.0 if k else 10_000.0 for k in known]})
    # Published two days ahead, so every hour has a decision forecast.
    forecasts = pd.DataFrame({"publishTime": times - pd.Timedelta(hours=48), "startTime": times, "generation": 200.0})

    frame = build_decision_frame(forecasts, actuals, cutoff)
    last_day = frame[frame.deliveryDate == pd.Timestamp("2026-01-10").date()]
    assert last_day.historyPoints.unique().tolist() == [168]   # a full week of known hours
    assert last_day.ratio.round(6).unique().tolist() == [0.5]  # no post-cutoff actual leaked in
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


def test_band_uses_out_of_sample_errors_from_each_days_own_adjusted_forecast():
    # 20 days of noisy hourly data, forecast published 2 days ahead (09:00 cutoff, GMT).
    rng = np.random.default_rng(0)
    times = _hourly("2026-01-01T00:00", 20 * 24)
    fc = rng.uniform(5_000, 15_000, len(times))
    act = fc * rng.uniform(0.6, 1.1, len(times))
    forecasts = pd.DataFrame({"publishTime": times - pd.Timedelta(hours=48), "startTime": times, "generation": fc})
    actuals = pd.DataFrame({"startTime": times, "generation": act})
    frame = build_decision_frame(forecasts, actuals, time(9, 0))

    # Naive reference: each day's ratio from its own trailing week of known hours ...
    f, a = pd.Series(fc, index=times), pd.Series(act, index=times)
    days = sorted({t.date() for t in times})

    def window(day):
        cutoff = pd.Timestamp(day, tz="UTC") - pd.Timedelta(days=1) + pd.Timedelta(hours=9)
        known_at = times + pd.Timedelta(minutes=30)
        return times[(known_at <= cutoff) & (known_at > cutoff - pd.Timedelta(days=7))]

    ratio = {}
    for d in days:
        w = window(d)
        if len(w) >= 24:
            ratio[d] = a[w].sum() / f[w].sum()

    # ... and the band for day D from the errors those earlier adjusted forecasts actually made.
    target = pd.Timestamp("2026-01-18").date()
    w = [t for t in window(target) if t.date() in ratio]
    residuals = pd.Series([a[t] - ratio[t.date()] * f[t] for t in w])
    row = frame[frame.startTime == pd.Timestamp("2026-01-18T12:00Z")].iloc[0]
    assert row.adjusted == pytest.approx(ratio[target] * f[row.startTime])
    assert row.low == pytest.approx(row.adjusted + residuals.quantile(0.1))
    assert row.high == pytest.approx(row.adjusted + residuals.quantile(0.9))


def test_band_coverage_counts_actuals_inside_band():
    from app.analysis import band_coverage
    f = pd.DataFrame({"actual": [5.0, 0.0, 20.0, 10.0], "low": [0.0] * 4, "high": [10.0] * 4})
    m = band_coverage(f)
    assert (m["n"], m["coverage"], m["below"], m["above"]) == (4, 0.75, 0.0, 0.25)


def test_horizon_metrics_has_bucket_for_already_elapsed_hours():
    from app.analysis import horizon_metrics
    t = pd.Timestamp("2026-01-10T12:00Z")
    forecasts = pd.DataFrame({
        "publishTime": [t + pd.Timedelta(hours=2), t - pd.Timedelta(hours=3)],  # published after / before the hour
        "startTime": [t, t],
        "generation": [150.0, 300.0],
    })
    actuals = pd.DataFrame({"startTime": [t], "generation": [100.0]})
    rows = horizon_metrics(forecasts, actuals, t.date(), t.date())
    by = {r["group"]: r for r in rows}
    assert rows[0]["group"] == "<0h (already elapsed)"
    assert by["<0h (already elapsed)"]["errorBias"] == 50.0
    assert by["0-6h"]["errorBias"] == 200.0
