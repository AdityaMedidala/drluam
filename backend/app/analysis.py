"""Core analysis: what forecast did the buyer have, and how far off was it?

Key idea
--------
Day-ahead purchase decisions for delivery day D are made on D-1, before the
GB day-ahead auctions close (~09:20-09:50 UK). So for every target hour on day D
the relevant forecast is the LATEST one published at or before the cutoff on
D-1 -- not the newest forecast overall, which the buyer never saw in time.

Everything here is pure pandas (no I/O), so it is easy to unit test.
"""
from __future__ import annotations

from datetime import time

import numpy as np
import pandas as pd

UK_TZ = "Europe/London"
TRAILING_DAYS = 7          # history used for the bias correction and the uncertainty band
MIN_HISTORY_POINTS = 24    # need at least a day of matched hours before correcting
ACTUAL_PERIOD = pd.Timedelta(minutes=30)  # FUELHH settlement period length
PLAN_CONFIDENCES = (50, 70, 80, 90, 95)   # "plan on" levels: wind at least this much with C% confidence


# --------------------------------------------------------------------------- selection
def select_decision_forecast(
    forecasts: pd.DataFrame,
    cutoff: time = time(9, 0),
    tz: str = UK_TZ,
) -> pd.DataFrame:
    """Return one forecast per target time: the latest published before the D-1 cutoff.

    forecasts: columns publishTime, startTime (tz-aware UTC), generation.
    cutoff:    local (UK) time on the day before delivery when the decision is made.

    Returns columns: startTime, deliveryDate, publishTime, cutoffUtc, forecast, horizonHours.
    """
    df = forecasts[["publishTime", "startTime", "generation"]].copy()

    # Delivery day = the UK calendar day the target hour falls in.
    df["deliveryDate"] = df["startTime"].dt.tz_convert(tz).dt.date

    # Decision cutoff = cutoff time (UK local) on the day before delivery, in UTC.
    decision_day = pd.to_datetime(df["deliveryDate"]) - pd.Timedelta(days=1)
    cutoff_local = (decision_day + pd.Timedelta(hours=cutoff.hour, minutes=cutoff.minute)).dt.tz_localize(
        tz, ambiguous="NaT", nonexistent="shift_forward"
    )
    df["cutoffUtc"] = cutoff_local.dt.tz_convert("UTC")

    # Only forecasts the buyer could have seen at decision time ...
    eligible = df[df["publishTime"] <= df["cutoffUtc"]]

    # ... and of those, the most recent one for each target time.
    latest = (
        eligible.sort_values(["startTime", "publishTime"])
        .groupby("startTime", as_index=False)
        .last()
    )
    latest["horizonHours"] = (latest["startTime"] - latest["publishTime"]).dt.total_seconds() / 3600
    return latest.rename(columns={"generation": "forecast"})[
        ["startTime", "deliveryDate", "publishTime", "cutoffUtc", "forecast", "horizonHours"]
    ]


def forecast_runs(forecasts: pd.DataFrame, delivery_date, cutoff: time = time(9, 0), tz: str = UK_TZ) -> pd.DataFrame:
    """Every forecast run published at or before the D-1 cutoff, for the hours of one delivery day.

    Shows how the forecast for that day drifted across runs; the latest run is the
    one the decision uses. Returns columns publishTime, startTime, forecast.
    """
    cutoff_utc = (pd.Timestamp(delivery_date) - pd.Timedelta(days=1) + pd.Timedelta(hours=cutoff.hour, minutes=cutoff.minute)
                  ).tz_localize(tz, ambiguous="NaT", nonexistent="shift_forward").tz_convert("UTC")
    day = forecasts["startTime"].dt.tz_convert(tz).dt.date == delivery_date
    runs = forecasts[day & (forecasts["publishTime"] <= cutoff_utc)]
    return runs.rename(columns={"generation": "forecast"})[["publishTime", "startTime", "forecast"]].sort_values(
        ["publishTime", "startTime"]).reset_index(drop=True)


# --------------------------------------------------------------------------- decision frame
def build_decision_frame(
    forecasts: pd.DataFrame,
    actuals: pd.DataFrame,
    cutoff: time = time(9, 0),
    trailing_days: int = TRAILING_DAYS,
) -> pd.DataFrame:
    """Decision forecast for every target hour, joined to the actual, plus the adjusted forecast and band.

    Adjusted forecast: raw forecast x ratio (sum actual / sum forecast) over the
    previous `trailing_days` of hours whose actuals were already known at the
    decision cutoff (half-hour ended, i.e. startTime + 30 min <= cutoff).

    Band: adjusted forecast + P10 / P90 of OUT-OF-SAMPLE residuals over the same
    window -- for each history hour, actual minus that day's own adjusted forecast
    (made with that day's own prior ratio), i.e. the errors the method really made.
    Plan on C%: adjusted forecast + the (1 - C) quantile of those same residuals,
    floored at 0 -- the wind we expect to see at least, C% of the time. plan90 is
    the P10 band edge.
    No information from after the cutoff is used.
    """
    frame = select_decision_forecast(forecasts, cutoff)
    frame = frame.merge(actuals[["startTime", "generation"]], on="startTime", how="left")
    frame = frame.rename(columns={"generation": "actual"}).sort_values("startTime").reset_index(drop=True)

    day_cutoffs = frame.groupby("deliveryDate")["cutoffUtc"].first()
    # A FUELHH half-hour is only known once it has ended (publication lag assumed ~0).
    known_at = frame["startTime"] + ACTUAL_PERIOD
    has_actual = frame["actual"].notna()

    def history(cutoff_utc):
        return has_actual & (known_at <= cutoff_utc) & (known_at > cutoff_utc - pd.Timedelta(days=trailing_days))

    # Pass 1: each day's ratio from its own trailing window.
    ratios = []
    for day, cutoff_utc in day_cutoffs.items():
        hist = frame[history(cutoff_utc)]
        ratio = hist["actual"].sum() / hist["forecast"].sum() if len(hist) >= MIN_HISTORY_POINTS else np.nan
        ratios.append((day, ratio, len(hist)))
    frame = frame.merge(pd.DataFrame(ratios, columns=["deliveryDate", "ratio", "historyPoints"]), on="deliveryDate", how="left")
    frame["adjusted"] = frame["forecast"] * frame["ratio"]

    # Pass 2: band from the residuals of those earlier, genuinely out-of-sample adjusted forecasts.
    residual = frame["actual"] - frame["adjusted"]
    plan_q = [round(1 - c / 100, 2) for c in PLAN_CONFIDENCES]
    plan_res = [f"planRes{c}" for c in PLAN_CONFIDENCES]
    bands = []
    for day, cutoff_utc in day_cutoffs.items():
        res = residual[history(cutoff_utc)].dropna()
        if len(res) >= MIN_HISTORY_POINTS:
            bands.append((day, res.quantile(0.1), res.quantile(0.9), len(res), *res.quantile(plan_q)))
        else:
            bands.append((day, np.nan, np.nan, len(res), *[np.nan] * len(plan_q)))
    columns = ["deliveryDate", "resP10", "resP90", "bandPoints", *plan_res]
    frame = frame.merge(pd.DataFrame(bands, columns=columns), on="deliveryDate", how="left")
    frame["low"] = frame["adjusted"] + frame["resP10"]
    frame["high"] = frame["adjusted"] + frame["resP90"]
    for c, col in zip(PLAN_CONFIDENCES, plan_res):
        frame[f"plan{c}"] = (frame["adjusted"] + frame[col]).clip(lower=0)
    frame["error"] = frame["forecast"] - frame["actual"]            # +ve = over-forecast
    frame["adjError"] = frame["adjusted"] - frame["actual"]
    return frame


def in_scope(frame: pd.DataFrame, first_day, last_day) -> pd.DataFrame:
    return frame[(frame["deliveryDate"] >= first_day) & (frame["deliveryDate"] <= last_day)]


# --------------------------------------------------------------------------- metrics
def error_metrics(error: pd.Series, actual: pd.Series) -> dict:
    """Accuracy metrics for forecast - actual errors (MW). +ve error = forecast too high."""
    error, actual = error.dropna(), actual.loc[error.dropna().index]
    if error.empty:
        return {"n": 0}
    mae = error.abs().mean()
    return {
        "n": int(len(error)),
        "bias": float(error.mean()),
        "mae": float(mae),
        "rmse": float(np.sqrt((error**2).mean())),
        "nmae": float(mae / actual.mean()),          # MAE as a share of mean generation
        "p10": float(error.quantile(0.1)),
        "p50": float(error.quantile(0.5)),
        "p90": float(error.quantile(0.9)),
        "overForecastShare": float((error > 0).mean()),
    }


def grouped_metrics(df: pd.DataFrame, by: pd.Series, error_cols=("error", "adjError")) -> list[dict]:
    """Bias and MAE per group, computed for every error column on the SAME hours
    (rows missing any of them are dropped), so raw vs adjusted is like for like."""
    df = df.dropna(subset=list(error_cols))
    rows = []
    for key, g in df.groupby(by.loc[df.index], observed=True, sort=True):
        row = {"group": str(key), "n": int(len(g))}
        for col in error_cols:
            e = g[col]
            row[f"{col}Bias"] = float(e.mean()) if len(e) else None
            row[f"{col}Mae"] = float(e.abs().mean()) if len(e) else None
        rows.append(row)
    return rows


ELAPSED_LABEL = "<0h (already elapsed)"


def horizon_metrics(forecasts: pd.DataFrame, actuals: pd.DataFrame, first_day, last_day,
                    bins=(0, 6, 12, 18, 24, 30, 36, 42, 48)) -> list[dict]:
    """Error of ALL forecasts (not just decision ones) by lead time -- does it shrink closer to delivery?

    Rows published after their target hour started (negative lead time) go in a
    separate "<0h (already elapsed)" bucket: they show the bias persists even
    for hours that have already happened.
    """
    m = forecasts.merge(actuals[["startTime", "generation"]], on="startTime", suffixes=("", "Actual"))
    m["deliveryDate"] = m["startTime"].dt.tz_convert(UK_TZ).dt.date
    m = in_scope(m, first_day, last_day)
    m["horizon"] = (m["startTime"] - m["publishTime"]).dt.total_seconds() / 3600
    m["error"] = m["generation"] - m["generationActual"]
    labels = [ELAPSED_LABEL] + [f"{a}-{b}h" for a, b in zip(bins[:-1], bins[1:])]
    m["bucket"] = pd.cut(m["horizon"], bins=[-np.inf, *bins], labels=labels, right=False)
    return grouped_metrics(m.dropna(subset=["bucket"]), m["bucket"], error_cols=("error",))


def band_coverage(frame: pd.DataFrame) -> dict:
    """How often the actual landed inside the P10-P90 band (nominally 80%)."""
    f = frame.dropna(subset=["actual", "low", "high"])
    if f.empty:
        return {"n": 0}
    return {
        "n": int(len(f)),
        "nominal": 0.8,
        "coverage": float(((f["actual"] >= f["low"]) & (f["actual"] <= f["high"])).mean()),
        "below": float((f["actual"] < f["low"]).mean()),
        "above": float((f["actual"] > f["high"]).mean()),
        "meanWidth": float((f["high"] - f["low"]).mean()),
    }


def representative_day(frame: pd.DataFrame):
    """The delivery day closest to the period's median on both daily NESO-forecast MAE and daily P90
    hit rate (by rank, so neither metric's scale dominates); ties go to the earlier day."""
    f = frame.dropna(subset=["actual", "plan90"])
    daily = f.assign(err=(f["forecast"] - f["actual"]).abs(), hit=f["actual"] >= f["plan90"]) \
             .groupby("deliveryDate")[["err", "hit"]].mean()
    ranks = daily.rank(pct=True)
    distance = (ranks - 0.5).abs().sum(axis=1)
    return distance.sort_index().idxmin()


def plan_hit_rate(frame: pd.DataFrame, confidence: int) -> dict:
    """How often the actual came in at or above the C% plan (the target is C%)."""
    f = frame.dropna(subset=["actual", f"plan{confidence}"])
    if f.empty:
        return {"n": 0}
    return {
        "n": int(len(f)),
        "hitRate": float((f["actual"] >= f[f"plan{confidence}"]).mean()),
        "target": confidence / 100,
    }


def error_histogram(error: pd.Series, width: int = 500) -> list[dict]:
    """Bins of `width` MW centred on multiples of `width`, so one bin is centred exactly on zero."""
    e = error.dropna()
    half = width / 2
    lo = np.floor((e.min() + half) / width) * width - half
    hi = np.ceil((e.max() - half) / width) * width + half
    counts, edges = np.histogram(e, bins=np.arange(lo, hi + width, width))
    return [
        {"from": float(a), "to": float(b), "mid": float((a + b) / 2), "count": int(c)}
        for a, b, c in zip(edges[:-1], edges[1:], counts)
    ]
