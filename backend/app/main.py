"""HTTP API for the wind forecast portal.

GET /api/meta                         date range, cutoff options, forecast publish schedule
GET /api/day?date=YYYY-MM-DD&cutoff=  decision forecast vs actual for one delivery day
GET /api/accuracy?cutoff=             accuracy of decision forecasts across January
GET /api/plan?date=&cutoff=&confidence=  wind to plan on at C% confidence, plus its January hit rate
GET /api/drift?date=&cutoff=          every forecast run for that day up to the cutoff (forecast drift)
GET /api/provenance                   data source, snapshot fetch time, checksum verification
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
from .data import (FIRST_DELIVERY, LAST_DELIVERY, load_actuals, load_forecasts, load_ml_development,
                   load_ml_predictions, provenance)

DEFAULT_CUTOFF = "09:20"  # EPEX day-ahead gate closure
CUTOFF_OPTIONS = ["06:00", "08:00", "09:00", "09:20", "09:30", "09:50", "10:00", "11:00"]
# Plan hit rates pooled over Nov 2025 - Sep 2026 decisions (7,775 hours), from
# analysis/plan_backtest.py and docs/plan-backtest.md. Those months aren't in the
# app's snapshot, so they are constants, valid only where the run selection is
# the same as at 09:20 (no WINDFOR run is published between 09:00 and 09:20 UK).
DEV_PLAN_HIT_RATES = {50: 0.495, 70: 0.6691, 80: 0.7561, 90: 0.8397, 95: 0.8938}
DEV_PLAN_CUTOFFS = {"09:00", "09:20"}
# (MWh short, MWh long) at each level over the same 7,775 hours, from analysis.plan_volumes
# (tests/test_plan.py recomputes them). Enough to find the 11-month lowest-cost level for any costs.
DEV_PLAN_VOLUMES = {50: (5032997, 4857127), 70: (2843679, 8220627), 80: (2019674, 10749809),
                    90: (1208053, 14708471), 95: (747046, 17940248)}
DEV_HOURS = 7775
DEV_PERIOD = {"firstDecision": date(2025, 11, 1), "lastDecision": date(2026, 9, 30)}

# The optional ML model (LightGBM + CQR, ADR-001 in docs/decisions.md): precomputed at the
# 09:20 decision time, which selects the same WINDFOR run as 09:00. Simple stays the default.
MODELS = ("simple", "ml")
ML_CUTOFFS = {"09:00", "09:20"}

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


def normalise_model(model: str, cutoff: str) -> str:
    """'simple' or 'ml'; ML only at the decision times it was precomputed for (else a 422)."""
    if model not in MODELS:
        raise HTTPException(422, f"model must be one of {list(MODELS)}, got {model!r}")
    if model == "ml" and cutoff not in ML_CUTOFFS:
        raise HTTPException(422, f"the ml model is precomputed for decision times {sorted(ML_CUTOFFS)} only, got {cutoff!r}")
    return model


@lru_cache(maxsize=len(CUTOFF_OPTIONS) * len(MODELS))
def decision_frame(cutoff_str: str, model: str = "simple") -> pd.DataFrame:
    """Cached per normalised cutoff and model -- callers pass normalise_cutoff()/normalise_model() output.

    The ML frame is the Simple frame with the January hours' adjusted forecast, 80% range and
    planning volumes replaced by the precomputed LightGBM + CQR values (same columns, same shapes).
    """
    frame = an.build_decision_frame(load_forecasts(), load_actuals(), time.fromisoformat(cutoff_str))
    if model == "simple":
        return frame
    ml = load_ml_predictions().set_index("startTime")
    cols = {"adjusted": "p50", "low": "p10", "high": "p90", **{f"plan{c}": f"plan{c}" for c in an.PLAN_CONFIDENCES}}
    frame = frame.copy()
    for col, src in cols.items():
        frame[col] = frame["startTime"].map(ml[src])        # NaN outside January: ML covers only the app's scope
    frame["ratio"] = np.nan                                 # the ratio is the Simple model's, not ML's
    frame["adjError"] = frame["adjusted"] - frame["actual"]
    jan = an.in_scope(frame, FIRST_DELIVERY, LAST_DELIVERY)
    assert jan["adjusted"].notna().all(), "every January hour must have an ML prediction"
    return frame


def scoped_frame(cutoff_str: str, model: str = "simple") -> pd.DataFrame:
    return an.in_scope(decision_frame(cutoff_str, model), FIRST_DELIVERY, LAST_DELIVERY)


def dev_hit_rates(model: str) -> dict:
    return {int(c): v for c, v in load_ml_development()["hitRates"].items()} if model == "ml" else DEV_PLAN_HIT_RATES


def dev_volumes(model: str) -> dict:
    return {int(c): tuple(v) for c, v in load_ml_development()["volumesMWh"].items()} if model == "ml" else DEV_PLAN_VOLUMES


def plan_calibration(cutoff_str: str, model: str = "simple") -> list[dict]:
    """Every plan level's target next to the hit rate it actually achieved (January, and pooled dev months)."""
    jan = scoped_frame(cutoff_str, model)
    dev = dev_hit_rates(model)
    return [
        {"confidence": c, "target": c / 100,
         "januaryHitRate": an.plan_hit_rate(jan, c).get("hitRate"),
         "developmentHitRate": dev[c] if cutoff_str in DEV_PLAN_CUTOFFS else None}
        for c in an.PLAN_CONFIDENCES
    ]


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


@lru_cache(maxsize=1)
def cached_provenance() -> dict:
    return provenance()   # hashing ~2 MB once per process is enough; the snapshot doesn't change at runtime


@app.get("/api/provenance")
def provenance_route():
    return cached_provenance()


@app.get("/api/meta")
def meta():
    pubs = load_forecasts()["publishTime"].drop_duplicates()
    schedule = pubs.dt.strftime("%H:%M").value_counts()
    return {
        "firstDelivery": FIRST_DELIVERY.isoformat(),
        "lastDelivery": LAST_DELIVERY.isoformat(),
        "defaultCutoff": DEFAULT_CUTOFF,
        # A typical day to open on (median daily MAE and P90 hit rate); any day stays reachable.
        "representativeDelivery": an.representative_day(scoped_frame(DEFAULT_CUTOFF)).isoformat(),
        "cutoffOptions": CUTOFF_OPTIONS,
        # Times forecasts are routinely published (UTC); one-off re-publishes are excluded.
        "publishSchedule": sorted(schedule[schedule > 5].index.tolist()),
    }


@app.get("/api/day")
def day(date_: date = Query(..., alias="date"), cutoff: str = DEFAULT_CUTOFF, model: str = "simple"):
    if not FIRST_DELIVERY <= date_ <= LAST_DELIVERY:
        raise HTTPException(400, f"date must be between {FIRST_DELIVERY} and {LAST_DELIVERY}")
    cutoff = normalise_cutoff(cutoff)
    model = normalise_model(model, cutoff)
    frame = decision_frame(cutoff, model)
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
        "historyPointsFull": an.TRAILING_DAYS * 24,   # a complete trailing week of hourly matches
        # Realised coverage of the band over all delivery days at this cutoff, for labelling.
        "bandCoverage": an.band_coverage(scoped_frame(cutoff, model)).get("coverage"),
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


@app.get("/api/plan")
def plan(date_: date = Query(..., alias="date"), cutoff: str = DEFAULT_CUTOFF, confidence: int = 80, model: str = "simple"):
    if not FIRST_DELIVERY <= date_ <= LAST_DELIVERY:
        raise HTTPException(400, f"date must be between {FIRST_DELIVERY} and {LAST_DELIVERY}")
    if confidence not in an.PLAN_CONFIDENCES:
        raise HTTPException(422, f"confidence must be one of {list(an.PLAN_CONFIDENCES)}, got {confidence}")
    cutoff = normalise_cutoff(cutoff)
    model = normalise_model(model, cutoff)
    col = f"plan{confidence}"
    hourly = decision_frame(cutoff, model)
    hourly = hourly[hourly["deliveryDate"] == date_]
    plan_mwh = float(hourly[col].sum(min_count=1))      # hourly MW x 1h
    raw_mwh = float(hourly["forecast"].sum())
    return clean({
        "date": date_,
        "cutoff": cutoff,
        "confidence": confidence,
        "hours": [{"time": r.startTime, "forecastMW": r.forecast, "adjustedMW": r.adjusted, "planMW": getattr(r, col)}
                  for r in hourly.itertuples()],
        "day": {
            "planMWh": plan_mwh,
            "rawForecastMWh": raw_mwh,
            "adjustedMWh": float(hourly["adjusted"].sum(min_count=1)),
            "extraToProcureMWh": raw_mwh - plan_mwh,   # energy to buy beyond what the raw forecast implies
        },
        # Backtest over every in-scope delivery day at this cutoff.
        "backtest": {"period": {"firstDelivery": FIRST_DELIVERY, "lastDelivery": LAST_DELIVERY},
                     **an.plan_hit_rate(scoped_frame(cutoff, model), confidence)},
        "calibration": plan_calibration(cutoff, model),
    })


@app.get("/api/cost")
def cost(cutoff: str = DEFAULT_CUTOFF,
         short: float = Query(100, gt=0, le=10_000, description="cost of being short, GBP/MWh"),
         long: float = Query(30, gt=0, le=10_000, description="cost of being long, GBP/MWh"),
         model: str = "simple"):
    """Cost-aware exceedance level: the newsvendor recommendation and a January cost backtest.

    Illustrative: the costs are the desk's assumptions, and nothing here changes the method.
    """
    cutoff = normalise_cutoff(cutoff)
    model = normalise_model(model, cutoff)
    return clean({
        "cutoff": cutoff,
        "short": short,
        "long": long,
        "recommended": an.recommended_level(short, long),
        # Nov 2025 - Sep 2026 lowest-cost level; measured only where the run selection matches 09:20.
        "development": {"bestLevel": an.best_level(dev_volumes(model), short, long), "hours": DEV_HOURS, "period": DEV_PERIOD}
                       if cutoff in DEV_PLAN_CUTOFFS else None,
        "backtest": {"period": {"firstDelivery": FIRST_DELIVERY, "lastDelivery": LAST_DELIVERY},
                     **an.cost_backtest(scoped_frame(cutoff, model), short, long)},
    })


@app.get("/api/drift")
def drift(date_: date = Query(..., alias="date"), cutoff: str = DEFAULT_CUTOFF):
    if not FIRST_DELIVERY <= date_ <= LAST_DELIVERY:
        raise HTTPException(400, f"date must be between {FIRST_DELIVERY} and {LAST_DELIVERY}")
    cutoff = normalise_cutoff(cutoff)
    runs = an.forecast_runs(load_forecasts(), date_, time.fromisoformat(cutoff))
    latest = runs["publishTime"].max() if len(runs) else None
    hours_in_day = int(decision_frame(cutoff)["deliveryDate"].eq(date_).sum())
    # Hours every run covers: the like-for-like basis for comparing runs.
    n_runs = runs["publishTime"].nunique()
    common = runs.groupby("startTime")["publishTime"].nunique().loc[lambda c: c == n_runs].index
    out = []
    for pub, g in runs.groupby("publishTime", sort=True):
        out.append({
            "publishedUtc": pub,
            "isDecisionRun": pub == latest,
            "hours": [{"time": t, "forecastMW": v} for t, v in zip(g["startTime"], g["forecast"])],
            # Day total only when the run covers every hour of the day (early runs may not reach it all).
            "dayMWh": float(g["forecast"].sum()) if len(g) == hours_in_day else None,
            "commonMWh": float(g.loc[g["startTime"].isin(common), "forecast"].sum()),
        })
    return clean({"date": date_, "cutoff": cutoff, "commonHours": len(common), "runs": out})


@app.get("/api/accuracy")
def accuracy(cutoff: str = DEFAULT_CUTOFF, model: str = "simple"):
    cutoff = normalise_cutoff(cutoff)
    model = normalise_model(model, cutoff)
    f = scoped_frame(cutoff, model).dropna(subset=["actual"])
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
            "daysAdjustedBetter": int(sum(d["maeAdjusted"] < d["maeRaw"] for d in daily)),
            "raw": an.error_metrics(both["error"], both["actual"]),
            "adjusted": an.error_metrics(both["adjError"], both["actual"]),
        },
        "band": an.band_coverage(f),
        "planCalibration": plan_calibration(cutoff, model),
        "byHour": an.grouped_metrics(f, uk_hour),
        "byLevel": an.grouped_metrics(f, level),
        "byHorizon": an.horizon_metrics(load_forecasts(), load_actuals(), FIRST_DELIVERY, LAST_DELIVERY),
        "daily": daily,
        "histogram": an.error_histogram(f["error"]),
    })
