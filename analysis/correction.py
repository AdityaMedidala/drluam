"""Level-aware correction vs the app's correction, per docs/correction.md (rule committed first).

Usage (from the repo root):
    python analysis/correction.py dev     # Nov 2025 - Sep 2026 (development)
    python analysis/correction.py vault   # Jan - Oct 2025, ONE run only (refuses to run twice)

Vault data, fetched only after the rule commit:
    python backend/scripts/fetch_data.py --first-delivery 2025-01-02 --last-delivery 2025-11-01 --out-dir analysis/vault-2025
"""
from __future__ import annotations

import sys
from datetime import datetime, time, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "analysis")]
from app import analysis as an  # noqa: E402

BANDS = [0, 5000, 10000, 15000, np.inf]     # <5, 5-10, 10-15, >=15 GW (lower edges inclusive)
WINDOW_DAYS = 14
VAULT_DIR = ROOT / "analysis" / "vault-2025"
VAULT_MARKER = VAULT_DIR / "VAULT_RUN.txt"
DEV_MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
VAULT_MONTHS = [f"2025-{m:02d}" for m in range(1, 11)]


def load_dir(d: Path, start: pd.Timestamp | None = None):
    a = pd.read_csv(d / "actuals_wind.csv")
    a["startTime"] = pd.to_datetime(a["startTime"], utc=True)
    f = pd.read_csv(d / "forecasts_wind.csv")
    for c in ("publishTime", "startTime"):
        f[c] = pd.to_datetime(f[c], utc=True)
    if start is not None:
        a, f = a[a["startTime"] >= start], f[f["publishTime"] >= start]
    return f, a[["startTime", "generation"]]


def level_adjusted(frame: pd.DataFrame) -> pd.Series:
    """Candidate: forecast x ratio of its level band over the trailing 14 days; 7-day single ratio if < 24 points."""
    known_at = frame["startTime"] + an.ACTUAL_PERIOD
    band = pd.cut(frame["forecast"], BANDS, right=False, labels=False)
    out = pd.Series(np.nan, index=frame.index)
    for day, cutoff in frame.groupby("deliveryDate")["cutoffUtc"].first().items():
        hist = frame["actual"].notna() & (known_at <= cutoff) & (known_at > cutoff - pd.Timedelta(days=WINDOW_DAYS))
        h = frame[hist]
        sums = h.groupby(band[hist])[["actual", "forecast"]].sum()
        counts = band[hist].value_counts()
        rows = frame["deliveryDate"] == day
        for i in frame.index[rows]:
            b = band[i]
            if counts.get(b, 0) >= an.MIN_HISTORY_POINTS:
                out[i] = frame.at[i, "forecast"] * sums.at[b, "actual"] / sums.at[b, "forecast"]
            else:
                out[i] = frame.at[i, "forecast"] * frame.at[i, "ratio"]   # app's 7-day ratio (NaN if none)
    return out


def evaluate(forecasts, actuals, months, first_cutoff=None) -> tuple[pd.DataFrame, dict]:
    fr = an.build_decision_frame(forecasts, actuals, time(9, 0))
    fr["candidate"] = level_adjusted(fr)
    fr["month"] = (pd.to_datetime(fr["deliveryDate"]) - pd.Timedelta(days=1)).dt.strftime("%Y-%m")
    s = fr[fr["month"].isin(months)].dropna(subset=["actual", "adjusted", "candidate"])
    if first_cutoff is not None:
        s = s[s["cutoffUtc"] >= first_cutoff]
    s = s.assign(curErr=s["adjusted"] - s["actual"], candErr=s["candidate"] - s["actual"])
    g = s.groupby("month")
    t = pd.DataFrame({
        "hours": g.size(),
        "raw MAE": g["error"].apply(lambda e: e.abs().mean()),
        "current MAE": g["curErr"].apply(lambda e: e.abs().mean()),
        "candidate MAE": g["candErr"].apply(lambda e: e.abs().mean()),
        "current bias": g["curErr"].mean(),
        "candidate bias": g["candErr"].mean(),
    }).reindex(months)
    t["MAE lower"] = t["candidate MAE"] < t["current MAE"]
    t["|bias| higher"] = t["candidate bias"].abs() > t["current bias"].abs()
    band_used = (s["candidate"] != s["forecast"] * s["ratio"]).mean()
    pooled = {"hours": len(s), "current MAE": round(s["curErr"].abs().mean()), "candidate MAE": round(s["candErr"].abs().mean()),
              "current bias": round(s["curErr"].mean()), "candidate bias": round(s["candErr"].mean()),
              "share of hours using a band ratio": round(band_used, 3),
              "first day": str(s["deliveryDate"].min()), "last day": str(s["deliveryDate"].max())}
    return t, pooled


def show(t: pd.DataFrame) -> str:
    cols = list(t.columns)
    lines = ["| month | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for m, r in t.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (bool, np.bool_)):
                cells.append("yes" if v else "no")
            elif c == "hours":
                cells.append(f"{int(v):,}")
            elif "bias" in c:
                cells.append(f"{v:+,.0f}")
            else:
                cells.append(f"{v:,.0f}")
        lines.append(f"| {m} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def main(mode: str):
    if mode == "dev":
        start = pd.Timestamp("2025-11-01", tz="UTC")
        fs, acts = zip(*(load_dir(ROOT / "analysis" / d, start) for d in ("data", "data-2026-04-09")))
        forecasts = pd.concat(fs).drop_duplicates(["publishTime", "startTime"], keep="last")
        actuals = pd.concat(acts).drop_duplicates("startTime", keep="last").sort_values("startTime")
        t, pooled = evaluate(forecasts, actuals, DEV_MONTHS, first_cutoff=start + pd.Timedelta(days=WINDOW_DAYS))
    elif mode == "vault":
        if VAULT_MARKER.exists():
            sys.exit(f"The vault has already been used ({VAULT_MARKER.read_text().strip()}). Refusing to run again.")
        forecasts, actuals = load_dir(VAULT_DIR)
        t, pooled = evaluate(forecasts, actuals, VAULT_MONTHS)
        VAULT_MARKER.write_text(f"vault run at {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")
    elif mode == "verify-vault":
        # Recompute the vault result to compare with docs/correction.md. Not a new run: no marker is checked or written.
        forecasts, actuals = load_dir(VAULT_DIR)
        t, pooled = evaluate(forecasts, actuals, VAULT_MONTHS)
    else:
        sys.exit("usage: correction.py dev|vault|verify-vault")

    print(f"<!-- {mode}: {pooled} -->\n")
    print(show(t))
    n_mae, n_bias = int(t["MAE lower"].sum()), int(t["|bias| higher"].sum())
    print(f"Months with lower MAE: {n_mae}/{len(t)}. Months with higher |bias|: {n_bias}/{len(t)}.")
    if mode in ("vault", "verify-vault"):
        verdict = "PASS" if n_mae >= 8 and n_bias <= 2 else "FAIL"
        print(f"Rule: MAE lower in >= 8 of 10 AND |bias| higher in <= 2 of 10. **Verdict: {verdict}**")
        ex = t.drop(index="2025-10")
        print(f"(Without Oct 2025, for transparency: MAE lower {int(ex['MAE lower'].sum())}/9, |bias| higher {int(ex['|bias| higher'].sum())}/9.)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
