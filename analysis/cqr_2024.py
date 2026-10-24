"""CQR out-of-period confirmation on 2024 (analysis only).

Rule pre-registered in docs/cqr-2024.md (commit a6d8e6e) before any 2023-2024 data was
fetched. The recipe is analysis/ml_challenger.py + analysis/cqr.py unchanged; this driver
sets only the dates and the data folder.

Usage (from the repo root):
    python analysis/cqr_2024.py report   # data availability, publish schedule, stop rule
    python analysis/cqr_2024.py run      # the one run; refuses to run twice
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cqr  # noqa: E402
import ml_challenger as ml  # noqa: E402
from ml_challenger import an  # noqa: E402

ml.DIRS["data-2023-2024"] = ml.ROOT / "analysis" / "data-2023-2024"
ml.TRAIN_START = date(2023, 1, 1)          # training_rows() reads this at call time
NAMES = ["data-2023-2024"]
FIRST, LAST = date(2024, 1, 1), date(2024, 12, 31)
PREDICT = ["2023-12"] + [f"2024-{m:02d}" for m in range(1, 13)]
RESULT = ml.ROOT / "analysis" / "cqr-2024-result.txt"
MAX_MISSING = 0.10


def uk_periods(d: date) -> int:
    start = pd.Timestamp(d).tz_localize(an.UK_TZ)
    return int((pd.Timestamp(d + pd.Timedelta(days=1)).tz_localize(an.UK_TZ) - start) / pd.Timedelta(minutes=30))


def report() -> bool:
    forecasts, actuals = ml.load(NAMES)
    fetched = json.loads((ml.DIRS[NAMES[0]] / "manifest.json").read_text())["fetchedAt"]
    lines = [f"## Data availability (fetched {fetched})\n"]
    ok, rows = True, []
    decision = an.select_decision_forecast(forecasts, ml.CUTOFF)
    uk_day = actuals["startTime"].dt.tz_convert(an.UK_TZ).dt.date
    for year in (2023, 2024):
        days = pd.date_range(f"{year}-01-01", f"{year}-12-31").date
        expected_half = sum(uk_periods(d) for d in days)
        have_half = int(((uk_day >= days[0]) & (uk_day <= days[-1])).sum())
        expected_hours = expected_half // 2
        dec = decision[(decision["deliveryDate"] >= days[0]) & (decision["deliveryDate"] <= days[-1])]
        hourly = dec[dec["startTime"].dt.minute == 0]
        runs = forecasts.loc[forecasts["publishTime"].dt.year == year, "publishTime"].drop_duplicates()
        miss_out = 1 - have_half / expected_half
        miss_dec = 1 - len(hourly) / expected_hours
        rows.append({"year": year, "outturn half-hours": f"{have_half:,} of {expected_half:,}", "outturn missing": f"{miss_out:.2%}",
                     "decision-forecast hours": f"{len(hourly):,} of {expected_hours:,}", "decision forecast missing": f"{miss_dec:.2%}",
                     "WINDFOR runs": f"{len(runs):,}", "runs per day": f"{len(runs) / len(days):.1f}",
                     "median lead at decision (h)": f"{dec['horizonHours'].median():.0f}"})
        if (year == 2023 and miss_out > MAX_MISSING) or miss_dec > MAX_MISSING:
            ok = False
    lines.append(ml.md(pd.DataFrame(rows)))
    lines.append("## WINDFOR publish schedule (UK local time of publication, share of runs)\n")
    sched = []
    for year in (2023, 2024):
        runs = forecasts.loc[forecasts["publishTime"].dt.year == year, "publishTime"].drop_duplicates()
        hhmm = runs.dt.tz_convert(an.UK_TZ).dt.strftime("%H:%M").value_counts(normalize=True).sort_index()
        sched.append({"year": year, "publish times": ", ".join(f"{t} ({v:.0%})" for t, v in hhmm.items() if v >= 0.01),
                      "other times": f"{hhmm[hhmm < 0.01].sum():.1%}"})
    lines.append(ml.md(pd.DataFrame(sched)))
    lines.append(f"**Stop rule:** {'passed, the run may go ahead.' if ok else 'FAILED, stop and report; the recipe is not changed.'}\n")
    print("\n".join(lines))
    return ok


def detail(df: pd.DataFrame) -> str:
    rows = []
    for g in sorted(df["month"].unique()) + ["all"]:
        part = df if g == "all" else df[df["month"] == g]
        for name, m in cqr.METHODS.items():
            s = cqr.summary(part, m)
            rows.append({"delivery month": g, "method": name, "hours": s["hours"], "coverage": cqr.pct(s["coverage"]),
                         "width": f"{s['width']:,.0f}", "pinball": f"{s['pinball']:,.0f}", "MAE": f"{s['mae']:,.0f}",
                         **{f"P{c} hit": cqr.pct(s[f"hit{c}"]) for c in cqr.LEVELS},
                         **{f"P{c} £m": f"{s[f'cost{c}'] / 1e6:,.1f}" for c in cqr.LEVELS}})
    return ml.md(pd.DataFrame(rows))


def run() -> None:
    if RESULT.exists():
        sys.exit(f"{RESULT.name} exists: the 2024 confirmation has already been run once.")
    if not report():
        sys.exit("Stop rule failed: not running.")
    forecasts, actuals = ml.load(NAMES)
    features = ml.build_features(forecasts, actuals)
    assert (features["latestInfoUtc"] <= features["cutoffUtc"]).all()

    frame = an.build_decision_frame(forecasts, actuals, ml.CUTOFF)
    frame["month"] = pd.to_datetime(frame["deliveryDate"]).dt.strftime("%Y-%m")   # delivery month
    scored = frame[(frame["deliveryDate"] >= FIRST) & (frame["deliveryDate"] <= LAST)
                   & (frame["bandPoints"] == 168) & frame["actual"].notna()]
    df = cqr.run(NAMES, PREDICT, scored)

    months = sorted(df["month"].unique())
    cov = {m: cqr.summary(df[df["month"] == m], cqr.METHODS["LightGBM + CQR"])["coverage"] for m in months}
    in_band = sum(0.75 <= v <= 0.85 for v in cov.values())
    pooled_cov = cqr.summary(df, cqr.METHODS["LightGBM + CQR"])["coverage"]
    pin = cqr.bootstrap(df)["pinball"]
    conditions = {
        f"coverage 75-85% in >= 9 of 12 months (got {in_band} of {len(months)})": in_band >= 9 and len(months) == 12,
        f"pooled coverage 75-85% (got {pooled_cov:.1%})": 0.75 <= pooled_cov <= 0.85,
        f"pooled pinball lower, 95% CI below zero (CQR - current {pin[0]:+,.0f} MW [{pin[1]:+,.0f}, {pin[2]:+,.0f}])": pin[0] < 0 and pin[2] < 0,
    }
    verdict = "confirmed out-of-period" if all(conditions.values()) else "not confirmed"
    text = "\n".join([
        f"**Verdict: {verdict}.**\n",
        *[f"- {'met' if v else 'NOT met'}: {k}" for k, v in conditions.items()],
        "\nMonthly CQR coverage (unrounded): " + ", ".join(f"{m} {v:.4f}" for m, v in cov.items()) + "\n",
        *cqr.tables(df, "2024, pooled", by_month=False),
        "### 2024 by delivery month, all methods\n",
        detail(df),
    ])
    RESULT.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    {"report": report, "run": run}[sys.argv[1]]()
