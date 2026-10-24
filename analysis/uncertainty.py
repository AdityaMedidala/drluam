"""Evaluate the current uncertainty band and three candidates, per docs/uncertainty.md.

The decision rule in docs/uncertainty.md was committed before this script was
run; this script applies it mechanically and prints the verdict. Analysis only:
the app is changed only if a candidate passes.

Usage (from the repo root, data as in analysis/error_anatomy.py):
    python analysis/uncertainty.py      # prints markdown tables, writes docs/img/uncertainty-*.png
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "analysis"))
from app import analysis as an  # noqa: E402
from error_anatomy import load  # noqa: E402  (same data, nothing before 1 Nov 2025)

IMG = ROOT / "docs" / "img"
QS = (0.10, 0.25, 0.50, 0.75, 0.90)
GAMMA = 0.005                     # pre-registered, not tuned
SELECTION = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
HOLDOUT = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
BANDS = {"B0": "current", "C1": "adaptive conformal", "C2": "level-scaled", "C3": "level-scaled + adaptive"}


def predict(frame: pd.DataFrame) -> pd.DataFrame:
    """Quantile predictions for every band, walking delivery days in decision order (no look-ahead)."""
    known_at = frame["startTime"] + an.ACTUAL_PERIOD
    resid = frame["actual"] - frame["adjusted"]
    rel = resid / frame["adjusted"]
    pred = {b: np.full((len(frame), len(QS)), np.nan) for b in BANDS}
    level = {b: np.array(QS, dtype=float) for b in ("C1", "C3")}
    prev_cutoff = None

    for day, cutoff in frame.groupby("deliveryDate")["cutoffUtc"].first().sort_values().items():
        # Adaptive levels: learn from hours that became known since the previous decision.
        if prev_cutoff is not None:
            new = (frame["actual"].notna() & (known_at > prev_cutoff) & (known_at <= cutoff)).to_numpy()
            for b in ("C1", "C3"):
                p = pred[b][new]
                ok = ~np.isnan(p).any(axis=1)
                if ok.any():
                    below = frame["actual"].to_numpy()[new][ok][:, None] <= p[ok]
                    level[b] = np.clip(level[b] + GAMMA * (np.array(QS) - below).sum(axis=0), 0.005, 0.995)
        prev_cutoff = cutoff

        hist = (frame["actual"].notna() & (known_at <= cutoff) & (known_at > cutoff - pd.Timedelta(days=an.TRAILING_DAYS))).to_numpy()
        r, rr = resid[hist].dropna(), rel[hist].dropna()
        rows = (frame["deliveryDate"] == day).to_numpy()
        adj = frame["adjusted"].to_numpy()[rows][:, None]
        if len(r) < an.MIN_HISTORY_POINTS or np.isnan(adj).all():
            continue
        pred["B0"][rows] = adj + np.quantile(r, QS)
        pred["C1"][rows] = adj + np.quantile(r, level["C1"])
        pred["C2"][rows] = adj * (1 + np.quantile(rr, QS))
        pred["C3"][rows] = adj * (1 + np.quantile(rr, level["C3"]))

    out = frame[["startTime", "deliveryDate", "actual", "adjusted", "low", "high", "bandPoints"]].copy()
    for b, p in pred.items():
        for j, q in enumerate(QS):
            out[f"{b}_{q}"] = p[:, j]
    return out


def pinball(y, p, q):
    d = y - p
    return np.maximum(q * d, (q - 1) * d)


def scores(df: pd.DataFrame, band: str) -> dict:
    y = df["actual"].to_numpy()
    p = np.column_stack([df[f"{band}_{q}"] for q in QS])
    return {
        "hours": len(df),
        "coverage": float(((y >= p[:, 0]) & (y <= p[:, -1])).mean()),
        "pinball": float(np.mean([pinball(y, p[:, j], q).mean() for j, q in enumerate(QS)])),
        "width": float((p[:, -1] - p[:, 0]).mean()),
        **{f"rel{q}": float((y <= p[:, j]).mean()) for j, q in enumerate(QS)},
    }


def md(df: pd.DataFrame) -> str:
    df = df.reset_index()
    lines = ["| " + " | ".join(map(str, df.columns)) + " |", "|---" * len(df.columns) + "|"]
    lines += ["| " + " | ".join(map(str, r)) + " |" for r in df.itertuples(index=False)]
    return "\n".join(lines) + "\n"


def main():
    forecasts, actuals = load()
    frame = an.build_decision_frame(forecasts, actuals, time(9, 0))
    frame = frame[frame["deliveryDate"] <= pd.Timestamp("2026-10-01").date()]
    p = predict(frame)

    # B0 must be the app's band exactly.
    sel = p.dropna(subset=["low"])
    assert np.allclose(sel["B0_0.1"], sel["low"]) and np.allclose(sel["B0_0.9"], sel["high"])

    p["month"] = (pd.to_datetime(p["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    scored = p[(p["bandPoints"] == 168) & p["actual"].notna()].dropna(subset=[f"{b}_{q}" for b in BANDS for q in QS])
    scored = scored[scored["month"].isin(SELECTION + HOLDOUT)]
    print(f"<!-- scored: {scored['deliveryDate'].nunique()} days, {len(scored):,} hours, first {scored['deliveryDate'].min()}, last {scored['deliveryDate'].max()} -->\n")

    monthly = {b: pd.DataFrame({m: scores(scored[scored["month"] == m], b) for m in SELECTION + HOLDOUT}).T for b in BANDS}
    pooled = {b: {s: scores(scored[scored["month"].isin(ms)], b) for s, ms in (("selection", SELECTION), ("holdout", HOLDOUT))} for b in BANDS}

    # ---------------------------------------------------------------- 1. current band
    print("## 1. Current band (B0) reliability\n")
    rel = pd.DataFrame({f"{s} ({pooled['B0'][s]['hours']:,} h)": [f"{pooled['B0'][s][f'rel{q}']:.0%}" for q in QS] for s in ("selection", "holdout")},
                       index=[f"P{int(q * 100)}" for q in QS])
    rel.index.name = "predicted quantile (target share below)"
    print(md(rel))
    m = monthly["B0"]
    print(md(pd.DataFrame({"hours": m["hours"].astype(int), "P10–P90 coverage": m["coverage"].map("{:.0%}".format),
                           "pinball (MW)": m["pinball"].map("{:,.0f}".format), "mean width (MW)": m["width"].map("{:,.0f}".format)}).rename_axis("month")))

    # ---------------------------------------------------------------- 2. selection
    print("## 2. Selection (Nov 2025 – Mar 2026, pooled)\n")
    t = pd.DataFrame({f"{b} {BANDS[b]}": {"P10–P90 coverage": f"{pooled[b]['selection']['coverage']:.1%}",
                                          "pinball (MW)": f"{pooled[b]['selection']['pinball']:,.1f}",
                                          "mean width (MW)": f"{pooled[b]['selection']['width']:,.0f}"} for b in BANDS}).T
    print(md(t.rename_axis("band")))
    cands = {b: pooled[b]["selection"]["pinball"] for b in ("C1", "C2", "C3")}
    finalist = min(cands, key=cands.get)
    beats = cands[finalist] < pooled["B0"]["selection"]["pinball"]
    print(f"Finalist: **{finalist}** (pooled pinball {cands[finalist]:,.1f} vs B0 {pooled['B0']['selection']['pinball']:,.1f}); beats B0 on selection: **{beats}**\n")

    # ---------------------------------------------------------------- 3. holdout
    print("## 3. Holdout (Apr – Sep 2026), finalist vs B0\n")
    f, b0 = monthly[finalist].loc[HOLDOUT], monthly["B0"].loc[HOLDOUT]
    cov_ok = (f["coverage"] - 0.80).abs() <= 0.05 + 1e-12
    pin_ok = f["pinball"] < b0["pinball"]
    t = pd.DataFrame({
        "hours": f["hours"].astype(int),
        f"{finalist} coverage": f["coverage"].map("{:.1%}".format), "within 75–85%": cov_ok.map({True: "yes", False: "no"}),
        f"{finalist} pinball": f["pinball"].map("{:,.1f}".format), "B0 pinball": b0["pinball"].map("{:,.1f}".format),
        "beats B0": pin_ok.map({True: "yes", False: "no"}),
        f"{finalist} width": f["width"].map("{:,.0f}".format), "B0 coverage": b0["coverage"].map("{:.1%}".format),
    }).rename_axis("month")
    print(md(t))
    adopt = bool(beats and cov_ok.sum() >= 5 and pin_ok.sum() >= 5)
    print(f"Coverage criterion: {int(cov_ok.sum())}/6 months (need ≥5). Pinball criterion: {int(pin_ok.sum())}/6 months (need ≥5). "
          f"**Verdict: {'ADOPT ' + finalist if adopt else 'REJECT — app keeps B0'}**\n")

    # ---------------------------------------------------------------- all bands, all months (reported regardless)
    print("## 4. Every band, every month\n")
    allm = pd.DataFrame({(b, k): monthly[b][k] for b in BANDS for k in ("coverage", "pinball", "width")})
    view = pd.DataFrame({f"{b} cov / pinball / width": [f"{c:.0%} / {pb:,.0f} / {w:,.0f}" for c, pb, w in
                                                        zip(allm[(b, 'coverage')], allm[(b, 'pinball')], allm[(b, 'width')])] for b in BANDS},
                        index=allm.index).rename_axis("month")
    print(md(view))

    # ---------------------------------------------------------------- chart: reliability diagram
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.8), sharey=True)
    styles = {"B0": ("#111827", "-", "o"), "C1": ("#2563eb", "--", "s"), "C2": ("#dc2626", "--", "^"), "C3": ("#9333ea", ":", "d")}
    for ax, s in zip(axes, ("selection", "holdout")):
        ax.plot([0, 1], [0, 1], color="#9ca3af", lw=1, label="perfect calibration")
        for b, (c, ls, mk) in styles.items():
            ax.plot(QS, [pooled[b][s][f"rel{q}"] for q in QS], color=c, ls=ls, marker=mk, label=f"{b} {BANDS[b]}")
        ax.set_title(f"{s.capitalize()}: {'Nov 2025 – Mar 2026' if s == 'selection' else 'Apr – Sep 2026'}")
        ax.set_xlabel("predicted quantile level")
        ax.set_xticks(QS, [f"P{int(q * 100)}" for q in QS])
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].set_ylabel("share of hours with actual ≤ prediction")
    axes[1].legend(frameon=False, fontsize=7, loc="upper left")
    fig.suptitle("Reliability diagram (on the diagonal = calibrated)")
    fig.tight_layout()
    IMG.mkdir(parents=True, exist_ok=True)
    fig.savefig(IMG / "uncertainty-reliability.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    main()
