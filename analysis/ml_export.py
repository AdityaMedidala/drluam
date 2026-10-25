"""Precompute the app's optional "ML" model (LightGBM + CQR) for January 2026 (ADR-001, docs/decisions.md).

The recipe is frozen: analysis/ml_challenger.py + analysis/cqr.py, unchanged. Each hour is
predicted by the model of its decision month (trained only on earlier deliveries) and
conformalized from the previous 28 days of out-of-sample predictions whose outturn was
known at its decision time. The app reads the result; it never runs a model.

Writes (into backend/data/ by default, sha256 recorded in manifest.json):
    ml_predictions.csv   every January delivery hour (scored) plus the December hours its
                         calibration windows use (calibration only, no adjusted values)
    ml_development.json  the same recipe's Nov 2025 - Sep 2026 hit rates and short/long
                         volumes per level, the ML analogue of the Simple constants in main.py

Usage (from the repo root; `make ml`):
    python analysis/ml_export.py [--out-dir backend/data]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cqr  # noqa: E402
import ml_challenger as ml  # noqa: E402
from ml_challenger import an  # noqa: E402

NAMES = ["vault-2025", "data", "data-2026-04-09"]
FIRST, LAST = date(2026, 1, 2), date(2026, 2, 1)          # the app's delivery days
PREDICT = ["2025-12", "2026-01"]                         # decision months covering every window
OUT = ml.ROOT / "backend" / "data"
ROUND = 1                                                # MW decimals in the CSV
RAW = {f"raw{int(round(a * 100)):02d}": ml.CHAL[a] for a in ml.ALPHAS}
ISO = "%Y-%m-%dT%H:%M:%SZ"


def predictions() -> pd.DataFrame:
    features = ml.build_features(*ml.load(NAMES))
    assert (features["latestInfoUtc"] <= features["cutoffUtc"]).all()
    oos = cqr.oos_predictions(features, PREDICT)
    jan = oos[(oos["deliveryDate"] >= FIRST) & (oos["deliveryDate"] <= LAST)]
    days = jan.groupby("deliveryDate")["cutoffUtc"].first()

    windows = []
    for day, cutoff_utc in days.items():
        cal = cqr.calibration_rows(oos, cutoff_utc)
        windows.append({"deliveryDate": day, "calibrationFrom": cal["startTime"].min(),
                        "calibrationTo": (cal["startTime"] + an.ACTUAL_PERIOD).max()})
    adj = cqr.adjustments(oos, days).merge(pd.DataFrame(windows), on="deliveryDate")
    scored = cqr.apply_cqr(jan.merge(adj, on="deliveryDate", how="left"))

    # December rows that some January calibration window uses.
    first_window = days.min() - cqr.WINDOW
    calib = oos[(oos["deliveryDate"] < FIRST) & (oos["startTime"] + an.ACTUAL_PERIOD > first_window)]

    out = pd.concat([scored, calib], ignore_index=True).sort_values("startTime").reset_index(drop=True)
    stamp = lambda col: pd.to_datetime(out[col], utc=True).dt.strftime(ISO)   # noqa: E731
    table = pd.DataFrame({
        "startTime": out["startTime"].dt.strftime(ISO),
        "deliveryDate": out["deliveryDate"].astype(str),
        "decisionMonth": out["month"],
        "trainedThrough": pd.to_datetime(out["trainedThrough"]).dt.strftime("%Y-%m-%d"),
        "actual": out["actual"],
        **{name: out[col] for name, col in RAW.items()},
        "scored": out["deliveryDate"].between(FIRST, LAST),
        "calibrationHours": out["calibrationHours"].astype("Int64"),
        "calibrationFrom": stamp("calibrationFrom"),
        "calibrationTo": stamp("calibrationTo"),
        "p10": out["cqrLow"], "p50": out["cqrP50"], "p90": out["cqrHigh"],
        **{f"plan{c}": out[f"cqrP{c}"] for c in cqr.LEVELS},
    })
    num = [c for c in table.columns if table[c].dtype.kind == "f"]
    table[num] = table[num].round(ROUND)
    return table


def development() -> dict:
    scored = ml.current_frame(["data", "data-2026-04-09"])
    scored = scored[scored["month"].isin(ml.DEV_MONTHS)]
    dev = cqr.run(NAMES, cqr.DEV_PREDICT, scored)
    # CQR's levels under the column names analysis.py expects (the frame also holds Simple's plan* columns).
    plans = dev[["actual", *(f"cqrP{c}" for c in cqr.LEVELS)]].rename(columns={f"cqrP{c}": f"plan{c}" for c in cqr.LEVELS})
    vols = an.plan_volumes(plans)
    return {
        "period": {"firstDecision": "2025-11-01", "lastDecision": "2026-09-30"},
        "hours": vols["hours"],
        "hitRates": {str(c): round(float(an.plan_hit_rate(plans, c)["hitRate"]), 4) for c in cqr.LEVELS},
        "volumesMWh": {str(c): [round(s), round(lg)] for c, (s, lg) in vols["levels"].items()},
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", type=Path, default=OUT)
    out_dir = p.parse_args().out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    table = predictions()
    table.to_csv(out_dir / "ml_predictions.csv", index=False)
    (out_dir / "ml_development.json").write_text(json.dumps(development(), indent=2) + "\n")

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    recipe = "LightGBM + CQR, frozen recipe of docs/cqr.md (analysis/ml_challenger.py, analysis/cqr.py); ADR-001"
    manifest["mlPredictions"] = {"file": "ml_predictions.csv", "sha256": sha256(out_dir / "ml_predictions.csv"),
                                 "rows": len(table), "scoredRows": int(table["scored"].sum()), "recipe": recipe,
                                 "generatedBy": "make ml (analysis/ml_export.py)"}
    manifest["mlDevelopment"] = {"file": "ml_development.json", "sha256": sha256(out_dir / "ml_development.json"),
                                 "recipe": recipe, "generatedBy": "make ml (analysis/ml_export.py)"}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(table):,} rows ({int(table['scored'].sum()):,} scored) to {out_dir / 'ml_predictions.csv'}")


if __name__ == "__main__":
    main()
