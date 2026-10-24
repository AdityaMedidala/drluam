"""Anatomy of the decision-time forecast error, Nov 2025 - Sep 2026 (analysis only).

Questions: timing vs level, ramps, a cap/plateau at high wind, whether run-to-run
disagreement predicts error, and the 10 worst days. Uses the app's selection
logic (backend/app/analysis.py, unchanged). Nothing here changes the app.

Data (outside backend/, not deployed):
    analysis/data/             fetched for docs/validation.md (Nov 2025 - Mar 2026)
    analysis/data-2026-04-09/  python backend/scripts/fetch_data.py --first-delivery 2026-04-02 \
                                   --last-delivery 2026-10-01 --out-dir analysis/data-2026-04-09
Anything published or timestamped before 1 Nov 2025 is dropped at load.

Usage (from the repo root):
    python analysis/error_anatomy.py     # prints markdown tables, writes docs/img/anatomy-*.png
"""
from __future__ import annotations

import sys
from datetime import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy.optimize import isotonic_regression  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import analysis as an  # noqa: E402

DATA_DIRS = [ROOT / "analysis" / "data", ROOT / "analysis" / "data-2026-04-09"]
IMG = ROOT / "docs" / "img"
START = pd.Timestamp("2025-11-01", tz="UTC")       # nothing earlier is used
FIRST_DELIVERY, LAST_DELIVERY = pd.Timestamp("2025-11-02").date(), pd.Timestamp("2026-10-01").date()
CUTOFF = time(9, 0)
RAMP_MW, RAMP_HOURS, RAMP_TOL = 2000, 3, 2
SHIFTS = range(-3, 4)

plt.rcParams.update({"figure.dpi": 110, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
C_FC, C_ACT, C_FIT = "#2563eb", "#111827", "#dc2626"


# --------------------------------------------------------------------------- data
def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    acts, fcs = [], []
    for d in DATA_DIRS:
        a = pd.read_csv(d / "actuals_wind.csv")
        a["startTime"] = pd.to_datetime(a["startTime"], utc=True)
        acts.append(a[["startTime", "generation"]])
        f = pd.read_csv(d / "forecasts_wind.csv")
        for c in ("publishTime", "startTime"):
            f[c] = pd.to_datetime(f[c], utc=True)
        fcs.append(f)
    actuals = pd.concat(acts).drop_duplicates("startTime", keep="last")
    forecasts = pd.concat(fcs).drop_duplicates(["publishTime", "startTime"], keep="last")
    actuals = actuals[actuals["startTime"] >= START].sort_values("startTime").reset_index(drop=True)
    forecasts = forecasts[forecasts["publishTime"] >= START].reset_index(drop=True)
    return forecasts, actuals


def decision_frame(forecasts, actuals) -> pd.DataFrame:
    f = an.select_decision_forecast(forecasts, CUTOFF)
    f = f[(f["deliveryDate"] >= FIRST_DELIVERY) & (f["deliveryDate"] <= LAST_DELIVERY)]
    f = f.merge(actuals.rename(columns={"generation": "actual"}), on="startTime", how="inner")
    f["error"] = f["forecast"] - f["actual"]
    f["month"] = pd.to_datetime(f["deliveryDate"]).dt.strftime("%Y-%m")
    return f.sort_values("startTime").reset_index(drop=True)


def run_value(forecasts: pd.DataFrame, publish: pd.Series, target: pd.Series) -> pd.Series:
    """Forecast from run `publish` for hour `target` (NaN if that run doesn't cover it)."""
    lut = forecasts.set_index(["publishTime", "startTime"])["generation"]
    lut = lut[~lut.index.duplicated()]
    return pd.Series(lut.reindex(pd.MultiIndex.from_arrays([publish, target])).to_numpy(), index=publish.index)


def md(df: pd.DataFrame, index=True) -> str:
    df = df.reset_index() if index else df
    lines = ["| " + " | ".join(map(str, df.columns)) + " |", "|---" * len(df.columns) + "|"]
    lines += ["| " + " | ".join(map(str, r)) + " |" for r in df.itertuples(index=False)]
    return "\n".join(lines) + "\n"


def save(fig, name):
    IMG.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(IMG / name, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------------------- 1. timing vs level
def timing(fr, forecasts):
    """Per day: MAE when the decision run is shifted by k hours, vs removing the day's mean error.

    shifted_k(t) = same run's forecast for t - k, so k > 0 means reality ran k hours late.
    Both are per-day oracles (one free parameter chosen with hindsight): upper bounds, not methods.
    """
    for k in SHIFTS:
        fr[f"s{k}"] = run_value(forecasts, fr["publishTime"], fr["startTime"] - pd.Timedelta(hours=k))
    ok = fr.dropna(subset=[f"s{k}" for k in SHIFTS])
    day = pd.DataFrame({k: (ok[f"s{k}"] - ok["actual"]).abs().groupby(ok["deliveryDate"]).mean() for k in SHIFTS})
    level = ok.groupby("deliveryDate")["error"].transform("mean")
    day["level"] = (ok["error"] - level).abs().groupby(ok["deliveryDate"]).mean()
    best_k = day[list(SHIFTS)].idxmin(axis=1)
    best = day[list(SHIFTS)].min(axis=1)

    table = pd.DataFrame({
        "mean daily MAE (MW)": day[list(SHIFTS)].mean().round(0).astype(int),
        "days where best": best_k.value_counts().reindex(list(SHIFTS), fill_value=0),
    })
    table.index = [f"{k:+d}h" for k in SHIFTS]
    table.index.name = "shift"
    summary = {
        "days": len(day),
        "mae0": round(day[0].mean()),
        "best_shift_mae": round(best.mean()),
        "level_mae": round(day["level"].mean()),
        "shift_gain": round(1 - best.mean() / day[0].mean(), 3),
        "level_gain": round(1 - day["level"].mean() / day[0].mean(), 3),
        "share_days_shift_beats_level": round((best < day["level"]).mean(), 3),
        "share_days_nonzero_best_10pct": round(((best_k != 0) & (best < 0.9 * day[0])).mean(), 3),
        "overall_bias_sq_share_of_mse": round((ok["error"].mean() ** 2) / (ok["error"] ** 2).mean(), 3),
        "daily_mean_sq_share_of_mse": round((level ** 2).mean() / (ok["error"] ** 2).mean(), 3),
    }

    fig, ax = plt.subplots(figsize=(6, 3.2))
    ax.plot(list(SHIFTS), day[list(SHIFTS)].mean(), "o-", color=C_FC, label="shift the forecast in time (same run)")
    ax.axhline(best.mean(), color=C_FC, ls=":", label="best shift chosen per day (oracle)")
    ax.axhline(day["level"].mean(), color=C_FIT, ls="--", label="remove the day's mean error instead (oracle)")
    ax.set_xlabel("shift k (h); k > 0 = actual arrives k hours after the forecast")
    ax.set_ylabel("mean daily MAE (MW)")
    ax.set_ylim(0, None)
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("Timing vs level: what a perfect per-day fix of each kind would remove")
    save(fig, "anatomy-1-timing.png")
    return table, summary


# --------------------------------------------------------------------------- 2. ramps
def ramp_events(times: pd.Series, delta: pd.Series) -> pd.DataFrame:
    """Contiguous hours with the same-direction >RAMP_MW change over RAMP_HOURS -> one event each."""
    d = pd.DataFrame({"t": times, "dir": np.sign(delta.where(delta.abs() > RAMP_MW, 0))})
    d = d[d["dir"] != 0].sort_values("t")
    new = (d["t"].diff() != pd.Timedelta(hours=1)) | (d["dir"].diff() != 0)
    d["event"] = new.cumsum()
    return d.groupby("event").agg(start=("t", "min"), end=("t", "max"), dir=("dir", "first")).reset_index(drop=True)


def match(a: pd.DataFrame, b: pd.DataFrame, tol: int) -> np.ndarray:
    """For each event in a: is there a same-direction event in b overlapping it within +/- tol hours?"""
    pad = pd.Timedelta(hours=tol)
    return np.array([((b["dir"] == r.dir) & (b["start"] <= r.end + pad) & (b["end"] >= r.start - pad)).any() for r in a.itertuples()], dtype=bool)


def ramps(fr, forecasts, actuals):
    a = actuals.set_index("startTime")["generation"]
    t = fr["startTime"]
    act_delta = pd.Series(a.reindex(t + pd.Timedelta(hours=RAMP_HOURS)).to_numpy() - fr["actual"].to_numpy(), index=fr.index)
    fc_delta = run_value(forecasts, fr["publishTime"], t + pd.Timedelta(hours=RAMP_HOURS)) - fr["forecast"]
    keep = act_delta.notna() & fc_delta.notna()
    A, F = ramp_events(t[keep], act_delta[keep]), ramp_events(t[keep], fc_delta[keep])

    rows = []
    for label, sel in (("up", 1), ("down", -1), ("all", None)):
        for tol in (RAMP_TOL, 0):
            if label != "all" and tol == 0:
                continue
            aa = A if sel is None else A[A["dir"] == sel]
            ff = F if sel is None else F[F["dir"] == sel]
            hit = int(match(aa, F, tol).sum())
            fa = int((~match(ff, A, tol)).sum())
            rows.append({"ramps": label, "timing tolerance": f"±{tol}h", "actual events": len(aa), "forecast events": len(ff),
                         "hits": hit, "misses": len(aa) - hit, "false alarms": fa,
                         "hit rate": f"{hit / len(aa):.0%}", "false-alarm ratio": f"{fa / len(ff):.0%}" if len(ff) else "–"})
    table = pd.DataFrame(rows)

    # Size: forecast vs actual 3h change on hours where the actual ramped.
    big = act_delta[keep].abs() > RAMP_MW
    size = {"actual_ramp_hours": int(big.sum()),
            "median_fc_change_as_share_of_actual": round(float((fc_delta[keep][big].abs() / act_delta[keep][big].abs()).median()), 2),
            "actual_events_per_month": round(len(A) / fr["month"].nunique(), 1)}

    fig, ax = plt.subplots(figsize=(6, 3.2))
    sub = table[table["timing tolerance"] == f"±{RAMP_TOL}h"].set_index("ramps")
    x = np.arange(len(sub))
    for i, (col, c) in enumerate((("hits", C_FC), ("misses", C_FIT), ("false alarms", "#9ca3af"))):
        ax.bar(x + (i - 1) * 0.27, sub[col], 0.27, label=col, color=c)
        for xi, v in zip(x, sub[col]):
            ax.text(xi + (i - 1) * 0.27, v, str(v), ha="center", va="bottom", fontsize=8)
    ax.set_xticks(x, [f"{r} ramps" for r in sub.index])
    ax.set_ylabel("events")
    ax.legend(frameon=False)
    ax.set_title(f">{RAMP_MW / 1000:.0f} GW in {RAMP_HOURS}h: decision-time forecast vs actual (±{RAMP_TOL}h)")
    save(fig, "anatomy-2-ramps.png")
    return table, size


# --------------------------------------------------------------------------- 3. cap / plateau
def plateau(fr, actuals):
    x, y = fr["forecast"].to_numpy(), fr["actual"].to_numpy()
    order = np.argsort(x, kind="stable")
    iso = isotonic_regression(y[order]).x
    bins = np.arange(0, np.ceil(x.max() / 2000) * 2000 + 1, 2000)
    fr = fr.assign(bin=pd.cut(fr["forecast"], bins, right=False))
    g = fr.groupby("bin", observed=True)
    mids = np.array([(b.left + b.right) / 2 for b in g.size().index])
    fit = np.interp(mids, x[order], iso)
    table = pd.DataFrame({
        "hours": g.size().to_numpy(),
        "mean actual": g["actual"].mean().round(0).astype(int).to_numpy(),
        "actual / forecast": (g["actual"].sum() / g["forecast"].sum()).round(2).to_numpy(),
        "P90 actual": g["actual"].quantile(0.9).round(0).astype(int).to_numpy(),
        "isotonic fit": fit.round(0).astype(int),
        "fit slope": ["–"] + [f"{v:.2f}" for v in np.diff(fit) / np.diff(mids)],
    }, index=[f"{int(b.left / 1000)}–{int(b.right / 1000)} GW" for b in g.size().index])
    table.index.name = "forecast"

    hh = actuals[(actuals["startTime"] >= pd.Timestamp("2025-11-02", tz="UTC")) & (actuals["startTime"] < pd.Timestamp("2026-10-02", tz="UTC"))]
    monthly_max = hh.groupby(hh["startTime"].dt.strftime("%Y-%m"))["generation"].max()
    stats = {"max": hh["generation"].max(), "p99": hh["generation"].quantile(0.99), "p999": hh["generation"].quantile(0.999),
             "fc_max": x.max(), "fc_p99": np.quantile(x, 0.99), "monthly_max": monthly_max,
             "share_within_1gw_of_max": float((hh["generation"] >= hh["generation"].max() - 1000).mean())}

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hexbin(x, y, gridsize=45, cmap="Greys", mincnt=1, linewidths=0)
    lim = max(x.max(), y.max()) * 1.03
    ax.plot([0, lim], [0, lim], color="#6b7280", ls=":", lw=1, label="actual = forecast")
    ax.plot(x[order], iso, color=C_FIT, lw=2, label="isotonic fit (actual vs forecast)")
    ax.scatter(mids, table["mean actual"], color=C_FC, s=18, zorder=3, label="mean actual per 2 GW bin")
    ax.set_xlim(0, lim); ax.set_ylim(0, lim)
    ax.set_xlabel("decision-time forecast (MW)"); ax.set_ylabel("actual (MW)")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    ax.set_title("Actual vs forecast, Nov 2025 – Sep 2026 (hourly)")
    save(fig, "anatomy-3-plateau.png")
    return table, stats


# --------------------------------------------------------------------------- 4. run-to-run disagreement
def disagreement(fr, forecasts):
    """|decision run - 04:30 UK run on D-1| vs the decision forecast's absolute error.

    The decision run is the last before 09:00 UK: 07:30 UK in winter, 06:30 UK in
    summer (the WINDFOR schedule shifts with BST; there is no 07:30 run in summer).
    """
    day0 = fr["cutoffUtc"].dt.tz_convert(an.UK_TZ).dt.normalize()
    early = (day0 + pd.Timedelta(hours=4, minutes=30)).dt.tz_convert("UTC")
    fr = fr.assign(early_pub=early, early=run_value(forecasts, early, fr["startTime"]))
    fr = fr.dropna(subset=["early"])
    fr = fr[fr["publishTime"] > fr["early_pub"]].copy()   # decision run must be a later run
    fr["late_uk"] = fr["publishTime"].dt.tz_convert(an.UK_TZ).dt.strftime("%H:%M")
    fr["dis"] = (fr["forecast"] - fr["early"]).abs()
    fr["abs_err"] = fr["error"].abs()
    fr["season"] = np.where(fr["late_uk"] == "07:30", "winter: 07:30 vs 04:30", "summer: 06:30 vs 04:30")

    fr["q"] = pd.qcut(fr["dis"], 5, labels=[f"Q{i}" for i in range(1, 6)])
    g = fr.groupby("q", observed=True)
    table = pd.DataFrame({
        "disagreement (MW)": [f"{lo:,.0f}–{hi:,.0f}" for lo, hi in zip(g["dis"].min(), g["dis"].max())],
        "hours": g.size(),
        "MAE (MW)": g["abs_err"].mean().round(0).astype(int),
        "bias (MW)": g["error"].mean().round(0).astype(int).map(lambda v: f"{v:+,}"),
        "P90 |error| (MW)": g["abs_err"].quantile(0.9).round(0).astype(int),
    })
    table.index.name = "quintile"
    daily = fr.groupby("deliveryDate")[["dis", "abs_err"]].mean()
    lvl = pd.qcut(fr["forecast"], 3, labels=False)
    corr = {
        "hourly_spearman": round(fr["dis"].corr(fr["abs_err"], method="spearman"), 3),
        "daily_spearman": round(daily["dis"].corr(daily["abs_err"], method="spearman"), 3),
        "level_vs_abs_err_spearman": round(fr["forecast"].corr(fr["abs_err"], method="spearman"), 3),
        "within_level_tercile": [round(fr[lvl == b]["dis"].corr(fr[lvl == b]["abs_err"], method="spearman"), 3) for b in range(3)],
        "by_season": {s: round(x["dis"].corr(x["abs_err"], method="spearman"), 3) for s, x in fr.groupby("season")},
        "hours": len(fr), "late_runs": fr["late_uk"].value_counts().to_dict(),
        "q5_over_q1_mae": round(table["MAE (MW)"].iloc[-1] / table["MAE (MW)"].iloc[0], 2),
    }

    fig, ax = plt.subplots(figsize=(6, 3.2))
    ax.bar(table.index.astype(str), table["MAE (MW)"], color=C_FC, label="MAE")
    ax.plot(table.index.astype(str), table["P90 |error| (MW)"], "o--", color=C_FIT, label="P90 |error|")
    for i, v in enumerate(table["MAE (MW)"]):
        ax.text(i, v, f"{v:,}", ha="center", va="bottom", fontsize=8)
    ax.set_xlabel("quintile of |decision run − 04:30 run| (Q1 = runs agree)")
    ax.set_ylabel("decision-forecast error (MW)")
    ax.legend(frameon=False)
    ax.set_title("Does run-to-run disagreement predict error?")
    save(fig, "anatomy-4-disagreement.png")
    return table, corr, fr


# --------------------------------------------------------------------------- 5. worst days
def worst_days(fr, dis_fr):
    day = fr.groupby("deliveryDate").agg(MAE=("error", lambda e: e.abs().mean()), bias=("error", "mean"),
                                         actual=("actual", "mean"), forecast=("forecast", "mean"))
    shifts = pd.DataFrame({k: (fr[f"s{k}"] - fr["actual"]).abs().groupby(fr["deliveryDate"]).mean() for k in SHIFTS})
    day["best_k"] = shifts.idxmin(axis=1)
    day["best_mae"] = shifts.min(axis=1)
    day["level_mae"] = (fr["error"] - fr.groupby("deliveryDate")["error"].transform("mean")).abs().groupby(fr["deliveryDate"]).mean()
    dis = dis_fr.groupby("deliveryDate")["dis"].mean()
    day["dis"], day["dis_pct"] = dis, dis.rank(pct=True)
    worst = day.sort_values("MAE", ascending=False).head(10)

    t = pd.DataFrame({
        "MAE": worst["MAE"].round(0).astype(int).map("{:,}".format),
        "bias": worst["bias"].round(0).astype(int).map("{:+,}".format),
        "mean fc → actual": [f"{f / 1000:.1f} → {a / 1000:.1f} GW" for f, a in zip(worst["forecast"], worst["actual"])],
        "actual / fc": (worst["actual"] / worst["forecast"]).round(2),
        "MAE after removing day's mean error": worst["level_mae"].round(0).astype(int).map("{:,}".format),
        "best shift (MAE)": [f"{k:+d}h ({m:,.0f})" for k, m in zip(worst["best_k"], worst["best_mae"])],
        "run disagreement (pctile)": [f"{d:,.0f} MW ({p:.0%})" if pd.notna(d) else "–" for d, p in zip(worst["dis"], worst["dis_pct"])],
    })
    t.index = [pd.Timestamp(d).strftime("%a %d %b %Y") for d in worst.index]
    t.index.name = "delivery day"

    fig, axes = plt.subplots(2, 5, figsize=(12, 4.6), sharey=True)
    for ax, d in zip(axes.flat, worst.index):
        g = fr[fr["deliveryDate"] == d]
        h = g["startTime"].dt.tz_convert(an.UK_TZ).dt.hour
        ax.plot(h, g["forecast"] / 1000, color=C_FC, lw=1.6, label="decision forecast")
        ax.plot(h, g["actual"] / 1000, color=C_ACT, lw=1.6, label="actual")
        ax.set_title(f"{pd.Timestamp(d):%d %b %Y}\nMAE {worst.loc[d, 'MAE'] / 1000:.1f} GW", fontsize=8)
        ax.set_xticks([0, 12, 23])
    axes[0, 0].set_ylabel("GW"); axes[1, 0].set_ylabel("GW")
    axes[0, 0].legend(frameon=False, fontsize=7)
    fig.suptitle("The 10 worst delivery days by MAE (x = UK hour of day)")
    save(fig, "anatomy-5-worst-days.png")
    return t, worst, day


def main():
    forecasts, actuals = load()
    fr = decision_frame(forecasts, actuals)
    print(f"<!-- {fr['deliveryDate'].nunique()} delivery days, {len(fr):,} hours, {fr['deliveryDate'].min()} -> {fr['deliveryDate'].max()}; "
          f"earliest publish used {forecasts.publishTime.min()}, earliest actual {actuals.startTime.min()} -->")
    print(f"<!-- overall bias {fr.error.mean():+,.0f} MW, MAE {fr.error.abs().mean():,.0f} MW; monthly bias "
          f"{fr.groupby('month').error.mean().round(0).astype(int).to_dict()}; monthly MAE {fr.groupby('month').error.apply(lambda e: e.abs().mean()).round(0).astype(int).to_dict()} -->\n")

    t1, s1 = timing(fr, forecasts)
    print("## 1. timing\n"); print(md(t1)); print(f"<!-- {s1} -->\n")
    t2, s2 = ramps(fr, forecasts, actuals)
    print("## 2. ramps\n"); print(md(t2, index=False)); print(f"<!-- {s2} -->\n")
    t3, s3 = plateau(fr, actuals)
    print("## 3. plateau\n"); print(md(t3))
    print(f"<!-- actual max {s3['max']:,.0f} p99 {s3['p99']:,.0f} p99.9 {s3['p999']:,.0f}; forecast max {s3['fc_max']:,.0f} p99 {s3['fc_p99']:,.0f}; "
          f"share of half-hours within 1 GW of max {s3['share_within_1gw_of_max']:.3f}; monthly max {s3['monthly_max'].round(0).astype(int).to_dict()} -->\n")
    t4, c4, dis_fr = disagreement(fr, forecasts)
    print("## 4. disagreement\n"); print(md(t4)); print(f"<!-- {c4} -->\n")
    t5, worst, day = worst_days(fr, dis_fr)
    print("## 5. worst days\n"); print(md(t5))
    print(f"<!-- worst-day months {pd.to_datetime(worst.index).strftime('%Y-%m').value_counts().to_dict()}; median daily MAE {day.MAE.median():,.0f} -->")


if __name__ == "__main__":
    main()
