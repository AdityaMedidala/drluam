"""ML challenger: LightGBM quantile regression vs the app's method (analysis only).

The rule was pre-registered in docs/ml-challenger.md (commit 80d3858) before any
model was trained or any October 2026 data was fetched. Nothing here changes the app.

Usage (from the repo root; needs `pip install -r analysis/requirements-ml.txt`):
    python analysis/ml_challenger.py dev        # Nov 2025 - Sep 2026, rolling monthly retrain
    python analysis/ml_challenger.py october    # the one confirmation run; refuses to run twice

Data (gitignored CSVs, sha256 in each manifest.json):
    analysis/vault-2025/       Dec 2024 - Oct 2025, used as TRAINING data only
    analysis/data/             Oct 2025 - Mar 2026
    analysis/data-2026-04-09/  Mar 2026 - Sep 2026
    analysis/data-2026-10/     Sep - Oct 2026, fetched after the rule commit, read only by `october`
"""
from __future__ import annotations

import json
import sys
import time as clock
from datetime import date, time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import analysis as an  # noqa: E402

CUTOFF = time(9, 20)
TRAIN_START = date(2025, 1, 1)                     # expanding window starts here
DEV_START = pd.Timestamp("2025-11-01", tz="UTC")   # the current method sees nothing earlier (as in plan_backtest.py)
DEV_MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
OCT_FIRST_DELIVERY = date(2026, 10, 2)             # decisions from 1 Oct; delivery 1 Oct belongs to September
DIRS = {name: ROOT / "analysis" / name for name in ("vault-2025", "data", "data-2026-04-09", "data-2026-10")}
OCT_RESULT = ROOT / "analysis" / "ml-challenger-october.json"

ALPHAS = (0.05, 0.10, 0.20, 0.30, 0.50, 0.90)
PINBALL_ALPHAS = (0.10, 0.50, 0.90)
# The app's quantiles at each alpha: planning volumes (floored at 0) and the 80% range's high edge.
CURRENT = {0.05: "plan95", 0.10: "plan90", 0.20: "plan80", 0.30: "plan70", 0.50: "plan50", 0.90: "high"}
CHAL = {a: f"q{a:.2f}" for a in ALPHAS}
LEVEL_ALPHA = {50: 0.50, 70: 0.30, 80: 0.20, 90: 0.10, 95: 0.05}
FEATURES = ["level", "hourOfDay", "dayOfWeek", "leadHours", "revision", "ratio", "meanError"]
FEATURE_WORDS = {
    "level": "the decision-run forecast itself",
    "hourOfDay": "hour of day",
    "dayOfWeek": "day of week",
    "leadHours": "hours ahead",
    "revision": "change since the previous run",
    "ratio": "last week's outturn-to-forecast ratio",
    "meanError": "last week's mean error",
}
PARAMS = dict(objective="quantile", n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=100,
              random_state=0, deterministic=True, force_row_wise=True, verbose=-1)
SHORT, LONG = 100, 30   # GBP/MWh, the cost backtest's defaults


# --------------------------------------------------------------------------- data
def load(names) -> tuple[pd.DataFrame, pd.DataFrame]:
    acts, fcs = [], []
    for name in names:
        a = pd.read_csv(DIRS[name] / "actuals_wind.csv")
        a["startTime"] = pd.to_datetime(a["startTime"], utc=True)
        acts.append(a[["startTime", "generation"]])
        f = pd.read_csv(DIRS[name] / "forecasts_wind.csv")
        for c in ("publishTime", "startTime"):
            f[c] = pd.to_datetime(f[c], utc=True)
        fcs.append(f[["publishTime", "startTime", "generation"]])
    actuals = pd.concat(acts).drop_duplicates("startTime", keep="last").sort_values("startTime").reset_index(drop=True)
    forecasts = pd.concat(fcs).drop_duplicates(["publishTime", "startTime"], keep="last").reset_index(drop=True)
    return forecasts, actuals


# --------------------------------------------------------------------------- features
def build_features(forecasts: pd.DataFrame, actuals: pd.DataFrame, cutoff: time = CUTOFF) -> pd.DataFrame:
    """One row per target hour: the pre-registered features, the target, and `latestInfoUtc`,
    the latest timestamp of any information the row's features used."""
    frame = an.build_decision_frame(forecasts, actuals, cutoff)
    local = frame["startTime"].dt.tz_convert(an.UK_TZ)
    frame["level"] = frame["forecast"]
    frame["hourOfDay"] = local.dt.hour
    frame["dayOfWeek"] = pd.to_datetime(frame["deliveryDate"]).dt.dayofweek
    frame["leadHours"] = frame["horizonHours"]

    # Revision: decision run minus the latest earlier run covering the same hour.
    runs = forecasts.sort_values(["startTime", "publishTime"]).copy()
    runs["prevPublish"] = runs.groupby("startTime")["publishTime"].shift(1)
    runs["prevForecast"] = runs.groupby("startTime")["generation"].shift(1)
    frame = frame.merge(runs[["startTime", "publishTime", "prevPublish", "prevForecast"]],
                        on=["startTime", "publishTime"], how="left")
    frame["revision"] = frame["forecast"] - frame["prevForecast"]

    # Trailing 7-day ratio (recomputed, checked against the app's) and mean error, per delivery day.
    known_at = frame["startTime"] + an.ACTUAL_PERIOD
    has_actual = frame["actual"].notna()
    stats = []
    for day, cutoff_utc in frame.groupby("deliveryDate")["cutoffUtc"].first().items():
        hist = frame[has_actual & (known_at <= cutoff_utc) & (known_at > cutoff_utc - pd.Timedelta(days=an.TRAILING_DAYS))]
        ok = len(hist) >= an.MIN_HISTORY_POINTS
        stats.append((day,
                      hist["actual"].sum() / hist["forecast"].sum() if ok else np.nan,
                      (hist["forecast"] - hist["actual"]).mean() if ok else np.nan,
                      (hist["startTime"] + an.ACTUAL_PERIOD).max() if len(hist) else pd.NaT))
    stats = pd.DataFrame(stats, columns=["deliveryDate", "ratioCheck", "meanError", "historyKnownUtc"])
    frame = frame.merge(stats, on="deliveryDate", how="left")
    both = frame["ratio"].notna() | frame["ratioCheck"].notna()
    mismatch = both & ~np.isclose(frame["ratio"], frame["ratioCheck"], rtol=0, atol=1e-12, equal_nan=False)
    if mismatch.any():
        raise AssertionError(f"recomputed ratio differs from the app's on {int(mismatch.sum())} rows")

    info = frame[["publishTime", "prevPublish", "historyKnownUtc"]].apply(lambda s: pd.to_datetime(s, utc=True))
    frame["latestInfoUtc"] = info.max(axis=1)
    return frame


def training_rows(features: pd.DataFrame, first_decision: date) -> pd.DataFrame:
    """Rows a model used from `first_decision` onwards may learn from: delivered from TRAIN_START,
    and over before `first_decision` begins, so every target is known at every later decision."""
    d = features["deliveryDate"]
    return features[(d >= TRAIN_START) & (d < first_decision) & features["actual"].notna()]


# --------------------------------------------------------------------------- models
def fit_quantiles(train: pd.DataFrame, alphas=ALPHAS, target: np.ndarray | None = None) -> dict:
    """One booster per alpha. LightGBM's native API with the pre-registered parameters
    (the sklearn wrapper would add scikit-learn as a dependency for nothing)."""
    import lightgbm as lgb   # analysis-only dependency, imported late so the feature tests don't need it
    y = train["actual"].to_numpy() if target is None else target
    params = {k: v for k, v in PARAMS.items() if k != "n_estimators"}
    return {a: lgb.train({**params, "alpha": a}, lgb.Dataset(train[FEATURES], y), num_boost_round=PARAMS["n_estimators"])
            for a in alphas}


def predict(models: dict, rows: pd.DataFrame) -> pd.DataFrame:
    """Per-row predictions at every alpha, sorted (no crossing) and floored at 0."""
    raw = np.column_stack([models[a].predict(rows[FEATURES]) for a in ALPHAS])
    raw = np.clip(np.sort(raw, axis=1), 0, None)
    return pd.DataFrame(raw, columns=[CHAL[a] for a in ALPHAS], index=rows.index)


# --------------------------------------------------------------------------- metrics
def pinball(q: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    d = y - q
    return np.maximum(alpha * d, (alpha - 1) * d)


def scores(df: pd.DataFrame, cols: dict) -> dict:
    y = df["actual"].to_numpy()
    q = {a: df[c].to_numpy() for a, c in cols.items()}
    return {
        "hours": int(len(df)),
        "mae": float(np.abs(q[0.50] - y).mean()),
        "pinball": float(np.mean([pinball(q[a], y, a).mean() for a in PINBALL_ALPHAS])),
        "coverage": float(((y >= q[0.10]) & (y <= q[0.90])).mean()),
    }


def hourly_losses(df: pd.DataFrame, cols: dict) -> pd.DataFrame:
    y = df["actual"].to_numpy()
    return pd.DataFrame({
        "deliveryDate": df["deliveryDate"].to_numpy(),
        "ae": np.abs(df[cols[0.50]].to_numpy() - y),
        "pinball": np.mean([pinball(df[cols[a]].to_numpy(), y, a) for a in PINBALL_ALPHAS], axis=0),
    })


def bootstrap_diff(df: pd.DataFrame, chal: dict, cur: dict, n: int = 10_000, seed: int = 0) -> dict:
    """Day-block bootstrap 95% intervals of challenger - current, for MAE and pinball loss."""
    a, b = hourly_losses(df, chal), hourly_losses(df, cur)
    days = (a.assign(dae=a["ae"] - b["ae"], dpin=a["pinball"] - b["pinball"], n=1)
            .groupby("deliveryDate")[["dae", "dpin", "n"]].sum())
    idx = np.random.default_rng(seed).integers(0, len(days), size=(n, len(days)))
    count = days["n"].to_numpy()[idx].sum(axis=1)
    out = {}
    for key, col in (("mae", "dae"), ("pinball", "dpin")):
        boot = days[col].to_numpy()[idx].sum(axis=1) / count
        out[key] = {"diff": float(days[col].sum() / days["n"].sum()),
                    "low": float(np.percentile(boot, 2.5)), "high": float(np.percentile(boot, 97.5))}
    return out


def costs(df: pd.DataFrame, cols: dict) -> dict:
    """Total cost (GBP) of planning on each exceedance level, at SHORT / LONG."""
    return {c: float(an.plan_cost(df[cols[a]], df["actual"], SHORT, LONG).sum()) for c, a in LEVEL_ALPHA.items()}


# --------------------------------------------------------------------------- runs
def current_frame(names) -> pd.DataFrame:
    """The app's method exactly as in plan_backtest.py: nothing before 1 Nov 2025, full week of residuals."""
    forecasts, actuals = load(names)
    actuals = actuals[actuals["startTime"] >= DEV_START].reset_index(drop=True)
    forecasts = forecasts[forecasts["publishTime"] >= DEV_START].reset_index(drop=True)
    frame = an.build_decision_frame(forecasts, actuals, CUTOFF)
    frame["month"] = (pd.to_datetime(frame["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    return frame[(frame["bandPoints"] == 168) & frame["actual"].notna()]


def run_month(features: pd.DataFrame, scored: pd.DataFrame, first_decision: date) -> tuple[pd.DataFrame, dict, float]:
    train = training_rows(features, first_decision)
    assert train["deliveryDate"].max() < first_decision
    t0 = clock.perf_counter()
    models = fit_quantiles(train)
    seconds = clock.perf_counter() - t0
    rows = features.set_index("startTime").loc[scored["startTime"]].reset_index()
    assert (rows["latestInfoUtc"] <= rows["cutoffUtc"]).all()
    out = scored.reset_index(drop=True).join(predict(models, rows).reset_index(drop=True))
    return out, models, seconds


def pct(v: float) -> str:
    return f"{v:.0%}"


def md(df: pd.DataFrame) -> str:
    lines = ["| " + " | ".join(map(str, df.columns)) + " |", "|---" * len(df.columns) + "|"]
    lines += ["| " + " | ".join(map(str, r)) + " |" for r in df.itertuples(index=False)]
    return "\n".join(lines) + "\n"


def dev() -> None:
    features = build_features(*load(["vault-2025", "data", "data-2026-04-09"]))
    scored = current_frame(["data", "data-2026-04-09"])
    scored = scored[scored["month"].isin(DEV_MONTHS)]
    print(f"Development hours scored: {len(scored):,}\n")

    parts, importance, seconds = [], [], 0.0
    for m in DEV_MONTHS:
        out, models, s = run_month(features, scored[scored["month"] == m], date.fromisoformat(f"{m}-01"))
        parts.append(out)
        seconds += s
        gain = models[0.50].feature_importance(importance_type="gain")
        importance.append(gain / gain.sum())
    allp = pd.concat(parts, ignore_index=True)

    rows = []
    for m in DEV_MONTHS + ["all"]:
        g = allp if m == "all" else allp[allp["month"] == m]
        c, x = scores(g, CURRENT), scores(g, CHAL)
        rows.append({"decision month": m, "hours": c["hours"],
                     "MAE current": f"{c['mae']:,.0f}", "MAE ML": f"{x['mae']:,.0f}",
                     "pinball current": f"{c['pinball']:,.0f}", "pinball ML": f"{x['pinball']:,.0f}",
                     "coverage current": pct(c["coverage"]), "coverage ML": pct(x["coverage"])})
    print("## Development results (MW; coverage = outturn inside P10-P90)\n")
    print(md(pd.DataFrame(rows)))

    boot = bootstrap_diff(allp, CHAL, CURRENT)
    print("Pooled ML - current, day-block bootstrap 95%:",
          {k: f"{v['diff']:+,.0f} MW [{v['low']:+,.0f}, {v['high']:+,.0f}]" for k, v in boot.items()})

    imp = pd.Series(np.mean(importance, axis=0), index=FEATURES).sort_values(ascending=False)
    print("\n## Feature importance, P50 model (share of total gain, mean over the 11 monthly models)\n")
    print(md(pd.DataFrame({"feature": [FEATURE_WORDS[f] for f in imp.index], "share": [pct(v) for v in imp]})))

    cc, cx = costs(allp, CURRENT), costs(allp, CHAL)
    print(f"\n## Cost backtest, short £{SHORT} / long £{LONG} per MWh, pooled development hours (£m)\n")
    print(md(pd.DataFrame([{"level": f"P{c}", "current": f"{cc[c] / 1e6:,.1f}", "ML": f"{cx[c] / 1e6:,.1f}",
                            "ML - current": f"{(cx[c] - cc[c]) / 1e6:+,.1f}"} for c in LEVEL_ALPHA])))

    # Shuffled-time sanity check on January 2026: permute the training targets across time.
    jan = scored[scored["month"] == "2026-01"]
    train = training_rows(features, date(2026, 1, 1))
    shuffled = np.random.default_rng(0).permutation(train["actual"].to_numpy())
    model = fit_quantiles(train, alphas=(0.50,), target=shuffled)[0.50]
    rows = features.set_index("startTime").loc[jan["startTime"]]
    mae_shuffled = float(np.abs(np.clip(model.predict(rows[FEATURES]), 0, None) - jan["actual"].to_numpy()).mean())
    janp = allp[allp["month"] == "2026-01"]
    print(f"\nShuffled-time check, Jan 2026 P50 MAE: shuffled {mae_shuffled:,.0f} MW, "
          f"real ML {scores(janp, CHAL)['mae']:,.0f} MW, current {scores(janp, CURRENT)['mae']:,.0f} MW")
    print(f"\nTraining time: {seconds:.1f} s for {len(DEV_MONTHS)} monthly retrains x {len(ALPHAS)} quantile models")


def october_result(last: date | None = None) -> dict:
    """The October 2026 confirmation, computed (nothing written). `last` pins the final delivery day (verify mode);
    by default it is the latest day with complete outturn, as in the one recorded run."""
    names = ["vault-2025", "data", "data-2026-04-09", "data-2026-10"]
    forecasts, actuals = load(names)
    # Latest delivery day with every half-hour of outturn (46 or 50 on clock-change days).
    uk_day = actuals["startTime"].dt.tz_convert(an.UK_TZ).dt.date
    per_day = actuals.groupby(uk_day).size()
    def periods(d):
        start = pd.Timestamp(d).tz_localize(an.UK_TZ)
        return int((pd.Timestamp(d + pd.Timedelta(days=1)).tz_localize(an.UK_TZ) - start) / pd.Timedelta(minutes=30))
    if last is None:
        last = max(d for d, n in per_day.items() if d >= OCT_FIRST_DELIVERY and n == periods(d))
    features = build_features(forecasts, actuals)
    scored = current_frame(names)
    scored = scored[(scored["deliveryDate"] >= OCT_FIRST_DELIVERY) & (scored["deliveryDate"] <= last)]
    out, models, seconds = run_month(features, scored, date(2026, 10, 1))

    c, x = scores(out, CURRENT), scores(out, CHAL)
    passed = {"mae": x["mae"] < c["mae"], "pinball": x["pinball"] < c["pinball"],
              "coverage": 0.75 <= x["coverage"] <= 0.85}
    result = {
        "period": {"firstDelivery": str(OCT_FIRST_DELIVERY), "lastDelivery": str(last), "days": int(out["deliveryDate"].nunique())},
        "current": c, "challenger": x, "bootstrap": bootstrap_diff(out, CHAL, CURRENT), "conditions": passed,
        "verdict": "ADOPTION-WORTHY" if all(passed.values()) else "NOT ADOPTION-WORTHY",
        "costsGBP": {"current": costs(out, CURRENT), "challenger": costs(out, CHAL)},
        "trainingSeconds": round(seconds, 1),
        "trainingRows": int(len(training_rows(features, date(2026, 10, 1)))),
    }
    return json.loads(json.dumps(result))   # same types as the recorded JSON


def october() -> None:
    if OCT_RESULT.exists():
        sys.exit(f"The October confirmation has already been run once ({OCT_RESULT.name}). The rule allows one run.")
    result = october_result()
    OCT_RESULT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


def verify_october() -> None:
    """Recompute the October confirmation and compare with the recorded result. Not a new run: nothing is written."""
    recorded = json.loads(OCT_RESULT.read_text())
    # Same period as the recorded run, even if later days have completed since.
    fresh = october_result(date.fromisoformat(recorded["period"]["lastDelivery"]))
    diffs = []
    def walk(a, b, path=""):
        if isinstance(a, dict):
            for k in a:
                if k != "trainingSeconds":   # wall-clock time, not a result
                    walk(a[k], b.get(k) if isinstance(b, dict) else None, f"{path}.{k}")
        elif isinstance(a, float) and isinstance(b, (int, float)):
            if abs(a - b) > 1e-9 * max(1.0, abs(a)):
                diffs.append(f"{path}: recorded {a}, now {b}")
        elif a != b:
            diffs.append(f"{path}: recorded {a!r}, now {b!r}")
    walk(recorded, fresh)
    print(f"verdict now: {fresh['verdict']} (recorded: {recorded['verdict']})")
    print("VERIFY OK: matches analysis/ml-challenger-october.json" if not diffs else "VERIFY MISMATCH\n" + "\n".join(diffs))
    sys.exit(1 if diffs else 0)


if __name__ == "__main__":
    {"dev": dev, "october": october, "verify-october": verify_october}[sys.argv[1] if len(sys.argv) > 1 else "dev"]()
