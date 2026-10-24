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
    decision cutoff. Band: adjusted forecast + P10 / P90 of the residuals over
    that same history. No information from after the cutoff is used.
    """
    frame = select_decision_forecast(forecasts, cutoff)
    frame = frame.merge(actuals[["startTime", "generation"]], on="startTime", how="left")
    frame = frame.rename(columns={"generation": "actual"}).sort_values("startTime").reset_index(drop=True)

    known = frame.dropna(subset=["actual"])
    per_day = []
    for day, cutoff_utc in frame.groupby("deliveryDate")["cutoffUtc"].first().items():
        hist = known[(known["startTime"] < cutoff_utc) & (known["startTime"] >= cutoff_utc - pd.Timedelta(days=trailing_days))]
        if len(hist) < MIN_HISTORY_POINTS:
            per_day.append((day, np.nan, np.nan, np.nan, len(hist)))
            continue
        ratio = hist["actual"].sum() / hist["forecast"].sum()
        residuals = hist["actual"] - ratio * hist["forecast"]
        per_day.append((day, ratio, residuals.quantile(0.1), residuals.quantile(0.9), len(hist)))

    corr = pd.DataFrame(per_day, columns=["deliveryDate", "ratio", "resP10", "resP90", "historyPoints"])
    frame = frame.merge(corr, on="deliveryDate", how="left")
    frame["adjusted"] = frame["forecast"] * frame["ratio"]
    frame["low"] = frame["adjusted"] + frame["resP10"]
    frame["high"] = frame["adjusted"] + frame["resP90"]
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
    rows = []
    for key, g in df.groupby(by, observed=True, sort=True):
        row = {"group": str(key), "n": int(len(g))}
        for col in error_cols:
            e = g[col].dropna()
            row[f"{col}Bias"] = float(e.mean()) if len(e) else None
            row[f"{col}Mae"] = float(e.abs().mean()) if len(e) else None
        rows.append(row)
    return rows


def horizon_metrics(forecasts: pd.DataFrame, actuals: pd.DataFrame, first_day, last_day,
                    bins=(0, 6, 12, 18, 24, 30, 36, 42, 48)) -> list[dict]:
    """Error of ALL forecasts (not just decision ones) by lead time -- does it shrink closer to delivery?"""
    m = forecasts.merge(actuals[["startTime", "generation"]], on="startTime", suffixes=("", "Actual"))
    m["deliveryDate"] = m["startTime"].dt.tz_convert(UK_TZ).dt.date
    m = in_scope(m, first_day, last_day)
    m["horizon"] = (m["startTime"] - m["publishTime"]).dt.total_seconds() / 3600
    m["error"] = m["generation"] - m["generationActual"]
    labels = [f"{a}-{b}h" for a, b in zip(bins[:-1], bins[1:])]
    m["bucket"] = pd.cut(m["horizon"], bins=list(bins), labels=labels, right=False)
    return grouped_metrics(m.dropna(subset=["bucket"]), m["bucket"], error_cols=("error",))


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
