"""Conformalized quantile regression on the LightGBM challenger (exploratory, analysis only).

Rule pre-registered in docs/cqr.md (commit 6608a98) before any computation. The base
model is analysis/ml_challenger.py unchanged. No new data is used.

Usage (from the repo root; needs `pip install -r analysis/requirements-ml.txt`):
    python analysis/cqr.py
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ml_challenger as ml  # noqa: E402
from ml_challenger import an  # noqa: E402

WINDOW = pd.Timedelta(days=28)    # calibration window, fixed in the rule
MIN_CALIBRATION = 168             # fewer hours than this: no adjustment for that day
LEVELS = (50, 70, 80, 90, 95)
LEVEL_ALPHA = {c: round(1 - c / 100, 2) for c in LEVELS}
DEV_PREDICT = [f"{y}-{m:02d}" for y, m in [(2025, 9), (2025, 10), (2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
OCT_PREDICT = ["2026-09", "2026-10"]


# --------------------------------------------------------------------------- out-of-sample predictions
def decision_month(delivery: pd.Series) -> pd.Series:
    return (pd.to_datetime(delivery) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")


def oos_predictions(features: pd.DataFrame, months: list[str]) -> pd.DataFrame:
    """Each hour predicted by the model of its own decision month (trained only on earlier deliveries)."""
    features = features.assign(month=decision_month(features["deliveryDate"]))
    parts = []
    for m in months:
        train = ml.training_rows(features, date.fromisoformat(f"{m}-01"))
        models = ml.fit_quantiles(train)
        rows = features[features["month"] == m]
        parts.append(rows[["startTime", "deliveryDate", "cutoffUtc", "actual", "month"]]
                     .join(ml.predict(models, rows)).assign(trainedThrough=train["deliveryDate"].max()))
        print(f"  model {m}: {len(train):,} training hours, {len(rows):,} predicted", flush=True)
    return pd.concat(parts, ignore_index=True)


# --------------------------------------------------------------------------- conformal
def conformal_quantile(scores: np.ndarray, coverage: float) -> float:
    """The ceil(coverage (n + 1))-th smallest score; +inf if that exceeds n."""
    n = len(scores)
    k = math.ceil(coverage * (n + 1))
    return float("inf") if k > n else float(np.sort(scores)[k - 1])


def calibration_rows(oos: pd.DataFrame, cutoff_utc: pd.Timestamp) -> pd.DataFrame:
    """Out-of-sample predictions whose outturn was known at `cutoff_utc`, within the previous 28 days."""
    known_at = oos["startTime"] + an.ACTUAL_PERIOD
    return oos[oos["actual"].notna() & (known_at <= cutoff_utc) & (known_at > cutoff_utc - WINDOW)]


def adjustments(oos: pd.DataFrame, days: pd.Series) -> pd.DataFrame:
    """Per delivery day: the conformal corrections, computed from that day's calibration window."""
    out = []
    for day, cutoff_utc in days.items():
        cal = calibration_rows(oos, cutoff_utc)
        assert ((cal["startTime"] + an.ACTUAL_PERIOD) <= cutoff_utc).all()
        assert (pd.to_datetime(cal["trainedThrough"]) < pd.to_datetime(cal["month"] + "-01")).all()
        row = {"deliveryDate": day, "calibrationHours": len(cal)}
        if len(cal) >= MIN_CALIBRATION:
            y = cal["actual"].to_numpy()
            q = {a: cal[ml.CHAL[a]].to_numpy() for a in ml.ALPHAS}
            row["Q2"] = conformal_quantile(np.maximum(q[0.10] - y, y - q[0.90]), 0.80)
            for c in LEVELS:
                row[f"Q{c}"] = conformal_quantile(q[LEVEL_ALPHA[c]] - y, c / 100)
            row["Qup"] = conformal_quantile(y - q[0.90], 0.90)
        out.append(row)
    return pd.DataFrame(out)


def apply_cqr(df: pd.DataFrame) -> pd.DataFrame:
    """CQR columns; days without enough calibration keep the raw challenger quantiles."""
    df = df.copy()
    z = lambda col: df[col].fillna(0.0) if col in df else 0.0   # noqa: E731
    df["cqrLow"] = (df[ml.CHAL[0.10]] - z("Q2")).clip(lower=0)
    df["cqrHigh"] = df[ml.CHAL[0.90]] + z("Q2")
    for c in LEVELS:
        df[f"cqrP{c}"] = (df[ml.CHAL[LEVEL_ALPHA[c]]] - z(f"Q{c}")).clip(lower=0)
    df["cqrUp"] = df[ml.CHAL[0.90]] + z("Qup")
    return df


# --------------------------------------------------------------------------- metrics
METHODS = {
    "current": {"q": {0.10: "plan90", 0.50: "plan50", 0.90: "high"}, "range": ("plan90", "high"),
                "levels": {c: f"plan{c}" for c in LEVELS}},
    "LightGBM raw": {"q": {a: ml.CHAL[a] for a in (0.10, 0.50, 0.90)}, "range": (ml.CHAL[0.10], ml.CHAL[0.90]),
                     "levels": {c: ml.CHAL[LEVEL_ALPHA[c]] for c in LEVELS}},
    "LightGBM + CQR": {"q": {0.10: "cqrP90", 0.50: "cqrP50", 0.90: "cqrUp"}, "range": ("cqrLow", "cqrHigh"),
                       "levels": {c: f"cqrP{c}" for c in LEVELS}},
}


def hourly(df: pd.DataFrame, m: dict) -> pd.DataFrame:
    y = df["actual"].to_numpy()
    lo, hi = (df[c].to_numpy() for c in m["range"])
    return pd.DataFrame({
        "deliveryDate": df["deliveryDate"].to_numpy(),
        "inside": ((y >= lo) & (y <= hi)).astype(float),
        "width": hi - lo,
        "pinball": np.mean([ml.pinball(df[m["q"][a]].to_numpy(), y, a) for a in (0.10, 0.50, 0.90)], axis=0),
        "ae": np.abs(df[m["q"][0.50]].to_numpy() - y),
        **{f"hit{c}": (y >= df[col].to_numpy()).astype(float) for c, col in m["levels"].items()},
        **{f"cost{c}": an.plan_cost(df[col], df["actual"], ml.SHORT, ml.LONG).to_numpy() for c, col in m["levels"].items()},
    })


def summary(df: pd.DataFrame, m: dict) -> dict:
    h = hourly(df, m)
    return {"hours": len(h), "coverage": h["inside"].mean(), "width": h["width"].mean(), "pinball": h["pinball"].mean(),
            "mae": h["ae"].mean(), **{f"hit{c}": h[f"hit{c}"].mean() for c in LEVELS},
            **{f"cost{c}": h[f"cost{c}"].sum() for c in LEVELS}}


def bootstrap(df: pd.DataFrame, n: int = 10_000, seed: int = 0) -> dict:
    """Day-block 95% intervals: CQR - current pinball and MAE, and CQR coverage."""
    c, x = hourly(df, METHODS["current"]), hourly(df, METHODS["LightGBM + CQR"])
    days = pd.DataFrame({"deliveryDate": c["deliveryDate"], "dpin": x["pinball"] - c["pinball"],
                         "dae": x["ae"] - c["ae"], "inside": x["inside"], "n": 1.0}).groupby("deliveryDate").sum()
    idx = np.random.default_rng(seed).integers(0, len(days), size=(n, len(days)))
    count = days["n"].to_numpy()[idx].sum(axis=1)
    out = {}
    for key, col in (("pinball", "dpin"), ("mae", "dae"), ("coverage", "inside")):
        boot = days[col].to_numpy()[idx].sum(axis=1) / count
        out[key] = (days[col].sum() / days["n"].sum(), np.percentile(boot, 2.5), np.percentile(boot, 97.5))
    return out


# --------------------------------------------------------------------------- report
def run(names: list[str], predict_months: list[str], scored: pd.DataFrame) -> pd.DataFrame:
    features = ml.build_features(*ml.load(names))
    oos = oos_predictions(features, predict_months)
    days = scored.groupby("deliveryDate")["cutoffUtc"].first()
    adj = adjustments(oos, days)
    merged = scored.merge(oos.drop(columns=["deliveryDate", "cutoffUtc", "actual", "month"]), on="startTime", how="left")
    assert merged[ml.CHAL[0.50]].notna().all()
    merged = apply_cqr(merged.merge(adj, on="deliveryDate", how="left"))
    short_days = int((adj["calibrationHours"] < MIN_CALIBRATION).sum())
    print(f"  calibration hours per day: min {adj['calibrationHours'].min()}, median {int(adj['calibrationHours'].median())}; "
          f"days without adjustment: {short_days}")
    return merged


def pct(v: float) -> str:
    return f"{v:.0%}"


def tables(df: pd.DataFrame, title: str, by_month: bool) -> list[str]:
    out = [f"### {title}\n"]
    if by_month:
        rows = []
        for g in sorted(df["month"].unique()) + ["all"]:
            part = df if g == "all" else df[df["month"] == g]
            s = {k: summary(part, m) for k, m in METHODS.items()}
            rows.append({"decision month": g, "hours": s["current"]["hours"],
                         **{f"coverage {k}": pct(v["coverage"]) for k, v in s.items()},
                         **{f"pinball {k}": f"{v['pinball']:,.0f}" for k, v in s.items()}})
        out.append(ml.md(pd.DataFrame(rows)))
    s = {k: summary(df, m) for k, m in METHODS.items()}
    out.append("Pooled, all metrics (MW unless stated):\n")
    out.append(ml.md(pd.DataFrame([{"method": k, "coverage": pct(v["coverage"]), "mean width": f"{v['width']:,.0f}",
                                    "pinball": f"{v['pinball']:,.0f}", "MAE": f"{v['mae']:,.0f}",
                                    **{f"P{c} hit (target {c}%)": pct(v[f'hit{c}']) for c in LEVELS}} for k, v in s.items()])))
    out.append(f"Cost backtest, short £{ml.SHORT} / long £{ml.LONG} per MWh (£m, GB-wide volume):\n")
    out.append(ml.md(pd.DataFrame([{"method": k, **{f"P{c}": f"{v[f'cost{c}'] / 1e6:,.1f}" for c in LEVELS}} for k, v in s.items()])))
    b = bootstrap(df)
    out.append("Day-block bootstrap, 95%: "
               f"CQR − current pinball {b['pinball'][0]:+,.0f} MW [{b['pinball'][1]:+,.0f}, {b['pinball'][2]:+,.0f}]; "
               f"CQR − current MAE {b['mae'][0]:+,.0f} MW [{b['mae'][1]:+,.0f}, {b['mae'][2]:+,.0f}]; "
               f"CQR coverage {pct(b['coverage'][0])} [{pct(b['coverage'][1])}, {pct(b['coverage'][2])}].\n")
    return out


def main() -> None:
    print("Development (Nov 2025 - Sep 2026):", flush=True)
    scored = ml.current_frame(["data", "data-2026-04-09"])
    scored = scored[scored["month"].isin(ml.DEV_MONTHS)]
    dev = run(["vault-2025", "data", "data-2026-04-09"], DEV_PREDICT, scored)

    cov = {m: summary(dev[dev["month"] == m], METHODS["LightGBM + CQR"])["coverage"] for m in ml.DEV_MONTHS}
    in_band = sum(0.75 <= v <= 0.85 for v in cov.values())
    pooled = {k: summary(dev, m)["pinball"] for k, m in METHODS.items()}
    promising = in_band >= 8 and pooled["LightGBM + CQR"] < pooled["current"]
    verdict = "promising, unconfirmed (needs Nov 2026+ data)" if promising else "not promising"

    print("\nOctober 2026 (already seen in the LightGBM study, not a clean holdout):", flush=True)
    names = ["vault-2025", "data", "data-2026-04-09", "data-2026-10"]
    oct_scored = ml.current_frame(names)
    last = date.fromisoformat(json.loads(ml.OCT_RESULT.read_text())["period"]["lastDelivery"])
    oct_scored = oct_scored[(oct_scored["deliveryDate"] >= ml.OCT_FIRST_DELIVERY) & (oct_scored["deliveryDate"] <= last)]
    october = run(names, OCT_PREDICT, oct_scored)

    print("\n" + "\n".join([
        f"**Verdict: {verdict}.** CQR coverage within 75–85% in {in_band} of 11 development months (needs ≥ 8); "
        f"pooled pinball loss CQR {pooled['LightGBM + CQR']:,.0f} MW vs current {pooled['current']:,.0f} MW.\n",
        *tables(dev, "Development, Nov 2025 – Sep 2026", by_month=True),
        *tables(october, "October 2026: already seen in the LightGBM study, not a clean holdout", by_month=False),
    ]))


if __name__ == "__main__":
    main()
