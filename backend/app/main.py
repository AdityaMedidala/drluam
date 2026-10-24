"""HTTP API for the wind forecast portal.

GET /api/meta                         date range, cutoff options, forecast publish schedule
GET /api/day?date=YYYY-MM-DD&cutoff=  decision forecast vs actual for one delivery day
GET /api/accuracy?cutoff=             accuracy of decision forecasts across January
"""
from __future__ import annotations

import math
from contextlib import asynccontextmanager
from datetime import date, time
from functools import lru_cache

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import analysis as an
from .data import FIRST_DELIVERY, LAST_DELIVERY, load_actuals, load_forecasts

DEFAULT_CUTOFF = "09:00"
CUTOFF_OPTIONS = ["06:00", "08:00", "09:00", "09:30", "10:00", "11:00"]

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Read the snapshot once at startup: a missing or broken CSV fails the deploy, not the first request.
    load_actuals()
    load_forecasts()
    yield


app = FastAPI(title="Wind Forecast Portal API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


# --------------------------------------------------------------------------- helpers
def normalise_cutoff(value: str) -> str:
    """'09:00:00' -> '09:00'; anything not in CUTOFF_OPTIONS is a 422."""
    try:
        norm = time.fromisoformat(value).strftime("%H:%M")
    except ValueError:
        norm = None
    if norm not in CUTOFF_OPTIONS:
        raise HTTPException(422, f"cutoff must be one of {CUTOFF_OPTIONS}, got {value!r}")
    return norm


def clean(obj):
    """Make pandas/numpy output JSON-safe: NaN/inf/NaT -> None, timestamps -> ISO strings."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    if obj is pd.NaT:
        return None
    if isinstance(obj, np.generic):
        obj = obj.item()
    if isinstance(obj, float):
        return round(obj, 4) if math.isfinite(obj) else None
    if isinstance(obj, pd.Timestamp):
        return None if pd.isna(obj) else obj.isoformat().replace("+00:00", "Z")
    if isinstance(obj, date):
        return obj.isoformat()
    return obj


@lru_cache(maxsize=len(CUTOFF_OPTIONS))
def decision_frame(cutoff_str: str) -> pd.DataFrame:
    """Cached per normalised cutoff -- callers pass normalise_cutoff() output."""
    return an.build_decision_frame(load_forecasts(), load_actuals(), time.fromisoformat(cutoff_str))


def scoped_frame(cutoff_str: str) -> pd.DataFrame:
    return an.in_scope(decision_frame(cutoff_str), FIRST_DELIVERY, LAST_DELIVERY)


# --------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    try:
        actual_rows, forecast_rows = len(load_actuals()), len(load_forecasts())
    except Exception as exc:  # noqa: BLE001 -- any load failure means the API can't serve data
        return JSONResponse({"status": "error", "detail": f"{type(exc).__name__}: {exc}"}, status_code=503)
    if not actual_rows or not forecast_rows:
        return JSONResponse({"status": "error", "detail": "data snapshot is empty"}, status_code=503)
    return {"status": "ok", "actualRows": actual_rows, "forecastRows": forecast_rows}


@app.get("/api/meta")
def meta():
    pubs = load_forecasts()["publishTime"].drop_duplicates()
    schedule = pubs.dt.strftime("%H:%M").value_counts()
    return {
        "firstDelivery": FIRST_DELIVERY.isoformat(),
        "lastDelivery": LAST_DELIVERY.isoformat(),
        "defaultCutoff": DEFAULT_CUTOFF,
        "cutoffOptions": CUTOFF_OPTIONS,
        # Times forecasts are routinely published (UTC); one-off re-publishes are excluded.
        "publishSchedule": sorted(schedule[schedule > 5].index.tolist()),
    }


@app.get("/api/day")
def day(date_: date = Query(..., alias="date"), cutoff: str = DEFAULT_CUTOFF):
    if not FIRST_DELIVERY <= date_ <= LAST_DELIVERY:
        raise HTTPException(400, f"date must be between {FIRST_DELIVERY} and {LAST_DELIVERY}")
    cutoff = normalise_cutoff(cutoff)
    frame = decision_frame(cutoff)
    hourly = frame[frame["deliveryDate"] == date_].set_index("startTime")

    start = pd.Timestamp(date_, tz=an.UK_TZ).tz_convert("UTC")
    end = pd.Timestamp(date_ + pd.Timedelta(days=1), tz=an.UK_TZ).tz_convert("UTC")
    acts = load_actuals()
    acts = acts[(acts["startTime"] >= start) & (acts["startTime"] < end)].set_index("startTime")["generation"]

    # One half-hourly series for the chart: actuals every 30 min, forecasts on the hour.
    idx = pd.date_range(start, end, freq="30min", inclusive="left")
    series = [
        {
            "time": t,
            "actual": acts.get(t, float("nan")),
            "forecast": hourly["forecast"].get(t, float("nan")),
            "adjusted": hourly["adjusted"].get(t, float("nan")),
            "low": hourly["low"].get(t, float("nan")),
            "high": hourly["high"].get(t, float("nan")),
        }
        for t in idx
    ]

    first = hourly.iloc[0] if len(hourly) else None
    return clean({
        "date": date_,
        "cutoff": cutoff,
        "decisionTimeUtc": first["cutoffUtc"] if first is not None else None,
        "forecastPublishedUtc": first["publishTime"] if first is not None else None,
        "horizonHours": [hourly["horizonHours"].min(), hourly["horizonHours"].max()] if len(hourly) else None,
        "correctionRatio": first["ratio"] if first is not None else None,
        "historyPoints": int(first["historyPoints"]) if first is not None else 0,
        # Realised coverage of the band over all delivery days at this cutoff, for labelling.
        "bandCoverage": an.band_coverage(scoped_frame(cutoff)).get("coverage"),
        "summary": {
            "forecastEnergyMWh": float(hourly["forecast"].sum()),      # hourly MW x 1h
            "adjustedEnergyMWh": float(hourly["adjusted"].sum(min_count=1)),
            "actualEnergyMWh": float(acts.sum() * 0.5),                # half-hourly MW x 0.5h
            "peakForecastMW": float(hourly["forecast"].max()) if len(hourly) else None,
            "minLowMW": float(hourly["low"].min()) if len(hourly) else None,
            "maeRaw": float(hourly["error"].abs().mean()),
            "maeAdjusted": float(hourly["adjError"].abs().mean()),
        },
        "series": series,
    })


@app.get("/api/accuracy")
def accuracy(cutoff: str = DEFAULT_CUTOFF):
    cutoff = normalise_cutoff(cutoff)
    f = scoped_frame(cutoff).dropna(subset=["actual"])
    both = f.dropna(subset=["adjusted"])  # hours where a correction was possible (enough history)

    uk_hour = f["startTime"].dt.tz_convert(an.UK_TZ).dt.hour
    level = pd.cut(f["forecast"], [0, 5000, 10000, 15000, 30000],
                   labels=["<5 GW", "5-10 GW", "10-15 GW", ">15 GW"])
    daily = (
        both.groupby("deliveryDate")  # same hours for raw and adjusted
        .agg(actual=("actual", "mean"), forecast=("forecast", "mean"), adjusted=("adjusted", "mean"),
             maeRaw=("error", lambda e: e.abs().mean()), maeAdjusted=("adjError", lambda e: e.abs().mean()))
        .reset_index()
        .to_dict("records")
    )
    return clean({
        "cutoff": cutoff,
        "period": {"firstDelivery": FIRST_DELIVERY, "lastDelivery": LAST_DELIVERY},
        "raw": an.error_metrics(f["error"], f["actual"]),
        "comparison": {
            "days": int(both["deliveryDate"].nunique()),
            "raw": an.error_metrics(both["error"], both["actual"]),
            "adjusted": an.error_metrics(both["adjError"], both["actual"]),
        },
        "band": an.band_coverage(f),
        "byHour": an.grouped_metrics(f, uk_hour),
        "byLevel": an.grouped_metrics(f, level),
        "byHorizon": an.horizon_metrics(load_forecasts(), load_actuals(), FIRST_DELIVERY, LAST_DELIVERY),
        "daily": daily,
        "histogram": an.error_histogram(f["error"]),
    })
