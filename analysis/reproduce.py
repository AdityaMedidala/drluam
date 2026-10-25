"""Reproduce every number in README.md and docs/ from Elexon, end to end (`make reproduce`).

1. Fetch every period (and the curtailment and NESO inputs) into a scratch folder and compare
   each CSV's sha256 with its committed manifest. Identical files are left alone; revised files
   are copied into analysis/ and flagged. Manifests and backend/data are never modified.
2. Rerun every study in its own process (images go to a scratch folder, not docs/img).
3. Run the pre-registered confirmations in "verify" mode: recompute and compare with the
   recorded result. Nothing is written, so this is not a new confirmation run.
4. Check the numbers: every table row a study prints must appear, number by number, in its doc;
   every number on a study's prose lines must appear in its doc; a registry of prose claims in the
   README, the ADR and the study docs must match the reproduced output.
5. Run the backend tests (golden README numbers) and the analysis tests (incl. `make ml` regeneration).

A fetched file whose sha256 differs from its manifest is reported by file:
  EXTENDED  every recorded row is unchanged and the source has only added rows past the recorded range
            (e.g. a day that has finished since); the checks use the recorded rows.
  REVISED   recorded values changed; the original is backed up, the checks run on the fetched copy, and the
            original is restored at the end, so local data always matches the committed manifests afterwards.

Prints a pass/fail table and exits non-zero on any FAIL (REVISED alone does not fail the run).

Usage (from the repo root):
    python analysis/reproduce.py                # full run, fetching from Elexon (`make reproduce`)
    python analysis/reproduce.py --skip-fetch   # the same checks on the local analysis data
    python analysis/reproduce.py --app-only     # app snapshot only: README headline numbers + backend tests (`make reproduce-app`)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "analysis" / ".reproduce"          # gitignored scratch folder
PY = sys.executable
FETCH = ROOT / "backend" / "scripts" / "fetch_data.py"

# Every Elexon period the docs use, with the fetch arguments that produced its committed manifest.
PERIODS = {
    "app snapshot (backend/data)": (ROOT / "backend" / "data", ["--first-delivery", "2026-01-02", "--last-delivery", "2026-02-01"]),
    "analysis/data": (ROOT / "analysis" / "data", ["--first-delivery", "2025-11-02", "--last-delivery", "2026-04-01"]),
    "analysis/data-2026-04-09": (ROOT / "analysis" / "data-2026-04-09", ["--first-delivery", "2026-04-02", "--last-delivery", "2026-10-01"]),
    "analysis/vault-2025": (ROOT / "analysis" / "vault-2025", ["--first-delivery", "2025-01-02", "--last-delivery", "2025-11-01"]),
    "analysis/data-2026-10": (ROOT / "analysis" / "data-2026-10", ["--first-delivery", "2026-10-02", "--last-delivery", "2026-10-23"]),
    "analysis/data-2023-2024": (ROOT / "analysis" / "data-2023-2024", ["--first-delivery", "2023-01-01", "--last-delivery", "2024-12-31", "--allow-gaps"]),
}

# study name -> (python snippet run with analysis/ on sys.path, docs it feeds)
IMG = "Path(os.environ['REPRODUCE_IMG'])"
STUDIES = {
    "validate": ("import validate as m; m.main()", ["docs/validation.md"]),
    "skill": ("import skill as m; m.main()", ["docs/validation.md"]),
    "error_anatomy": (f"import error_anatomy as m; m.IMG = {IMG}; m.main()", ["docs/error-anatomy.md"]),
    "uncertainty": (f"import uncertainty as m; m.IMG = {IMG}; m.main()", ["docs/uncertainty.md"]),
    "plan_backtest": ("import plan_backtest as m; m.main()", ["docs/plan-backtest.md"]),
    "cost_backtest": ("import cost_backtest as m; m.main()", ["docs/cost-backtest.md"]),
    "curtailment_check": ("sys.argv = ['curtailment_check.py']; import curtailment_check as m; m.main()", ["docs/curtailment-check.md"]),
    "correction dev": ("import correction as m; m.main('dev')", ["docs/correction.md"]),
    "ml_challenger dev": ("import ml_challenger as m; m.dev()", ["docs/ml-challenger.md"]),
    "cqr": ("import cqr as m; m.main()", ["docs/cqr.md"]),
}
# Output blocks a doc deliberately does not report: (study, block start, reason). The block runs to the next "## " heading or the end.
EXCLUDED = {
    "uncertainty": ("## 3. Holdout", "finalist's holdout months are not reported: by the rule no candidate reached the holdout"),
    "curtailment_check": ("Daily table:", "exploratory day-by-day dump; the doc reports the summary, levels and worst days"),
}
# Pre-registered confirmations, recomputed and compared with their recorded results (no new run).
VERIFY = {
    "vault confirmation (correction.md)": ("import correction as m; m.main('verify-vault')", ["docs/correction.md"]),
    "October 2026 confirmation (ml-challenger.md)": ("import ml_challenger as m; m.verify_october()", None),
    "2024 confirmation (cqr-2024.md)": ("import cqr_2024 as m; m.verify()", ["docs/cqr-2024.md"]),
}
# Prose claims: (doc, text in the doc, study, text the reproduced output must contain).
CLAIMS = [
    ("docs/decisions.md", "80% [78%, 83%]", "cqr", "CQR coverage 80% [78%, 83%]"),
    ("docs/decisions.md", "−50 MW [−79, −24]", "cqr", "pinball -50 MW [-79, -24]"),
    ("docs/decisions.md", "−100 MW [−182, −22]", "cqr", "MAE -100 MW [-182, -22]"),
    ("docs/decisions.md", "8 of 11", "cqr", "8 of 11 development months"),
    ("docs/decisions.md", "80.0% [78%, 82%]", "2024 confirmation (cqr-2024.md)", "CQR coverage 80% [78%, 82%]"),
    ("docs/decisions.md", "−55 MW [−81, −31]", "2024 confirmation (cqr-2024.md)", "pinball -55 MW [-81, -31]"),
    ("docs/decisions.md", "−101 MW [−169, −38]", "2024 confirmation (cqr-2024.md)", "MAE -101 MW [-169, -38]"),
    ("docs/decisions.md", "10 of 12", "2024 confirmation (cqr-2024.md)", "got 10 of 12"),
    ("README.md", "covered 80.0% of hours", "2024 confirmation (cqr-2024.md)", "pooled coverage 75-85% (got 80.0%)"),
    ("README.md", "[−81, −31]", "2024 confirmation (cqr-2024.md)", "[-81, -31]"),
    ("docs/cqr.md", "369 vs 420 MW", "cqr", "pooled pinball loss CQR 369 MW vs current 420 MW"),
    ("docs/ml-challenger.md", "−89 MW [−168, −14]", "ml_challenger dev", "'mae': '-89 MW [-168, -14]'"),
    ("docs/ml-challenger.md", "4,714 MW", "ml_challenger dev", "shuffled 4,714 MW"),
    ("docs/curtailment-check.md", "1,524 MW", "curtailment_check", "Mean accepted wind bids: 1,524 MW"),
]

NUM = re.compile(r"[-−+]?£?\d[\d,]*(?:\.\d+)?%?")
PROGRESS = ("  model ", "  calibration", "Training time", "Development hours", "<!--", "Wrote ", "1/5", "VERIFY", "verdict now")


def value(t: str) -> tuple[float, int, bool]:
    """(value, decimals, is_percent) of a normalised number."""
    pct = t.endswith("%")
    t = t.rstrip("%")
    return float(t), len(t.split(".")[1]) if "." in t else 0, pct


def same(out: str, doc: str) -> bool:
    """The output number, rounded to the doc's precision, equals the doc's number."""
    (v, _, p), (d, k, q) = value(out), value(doc)
    return p == q and abs(v - d) <= 0.5 * 10 ** -k + 1e-9


def norm(t: str) -> str:
    """One number, compared by value: unicode minus, £, +, thousands separators and trailing zeros don't matter."""
    t = t.replace("−", "-").replace("£", "").replace(",", "").lstrip("+")
    pct = t.endswith("%")
    t = t.rstrip("%")
    if "." in t:
        t = t.rstrip("0").rstrip(".")
    if t in ("-0", ""):
        t = "0"
    return t + ("%" if pct else "")


def tokens(line: str) -> list[str]:
    return [norm(t) for t in NUM.findall(line)]


def cells(line: str) -> list[str]:
    """A markdown table row's data cells (the first cell is a label and may be reworded in the doc)."""
    return line.strip().strip("|").split("|")[1:]


def subsequence(needle: list[str], hay: list[str]) -> bool:
    it = iter(hay)
    return all(any(same(n, h) for h in it) for n in needle)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_py(snippet: str, timeout: int = 3600) -> tuple[int, str, float]:
    env = {**os.environ, "MPLBACKEND": "Agg", "REPRODUCE_IMG": str(WORK / "img"), "PYTHONHASHSEED": "0"}
    code = f"import os, sys; from pathlib import Path; sys.path.insert(0, {str(ROOT / 'analysis')!r}); {snippet}"
    t0 = time.perf_counter()
    p = subprocess.run([PY, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr, time.perf_counter() - t0


# --------------------------------------------------------------------------- stages
def fetch_period(results: list, name: str) -> Path | None:
    """Fetch one period into the scratch folder; one result row per CSV. Returns the scratch folder."""
    target, args = PERIODS[name]
    out = WORK / "fetch" / re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")
    shutil.rmtree(out, ignore_errors=True)
    t0 = time.perf_counter()
    p = subprocess.run([PY, str(FETCH), *args, "--out-dir", str(out)], cwd=ROOT, capture_output=True, text=True)
    secs = time.perf_counter() - t0
    if p.returncode != 0:
        results.append(("fetch", name, False, f"fetch failed: {(p.stdout + p.stderr).strip()[-160:]}", secs))
        return None
    manifest = json.loads((target / "manifest.json").read_text())
    app = target == ROOT / "backend" / "data"
    for key in ("actuals", "forecasts"):
        f = manifest[key]["file"]
        rel = f"{target.relative_to(ROOT)}/{f}"
        status, detail = compare_fetched(out / f, target / f, manifest[key]["sha256"])
        if status == "REVISED":
            if app:
                detail += "; the README check uses the fetched copy, backend tests the committed one"
            else:
                substitute(target / f, out / f)
                detail += "; checks run on the fetched copy, original restored at the end"
        results.append(("fetch", rel, status, detail, secs))
        secs = 0.0   # report the fetch time once per period
    return out


def compare_fetched(fetched: Path, local: Path, want: str) -> tuple[bool | str, str]:
    """PASS if byte-identical to the manifest; EXTENDED if only rows were added after the recorded ones; else REVISED."""
    new = fetched.read_bytes()
    if sha256(fetched) == want:
        return True, "identical to the committed manifest (sha256)"
    if local.exists() and sha256(local) == want:
        old = local.read_bytes()
        if new.startswith(old):
            added = new[len(old):].count(b"\n")
            return "EXTENDED", (f"recorded rows unchanged; the source added {added} row(s) past the recorded range "
                                "(e.g. a day that has finished since); checks use the recorded rows")
        return "REVISED", "sha256 differs and recorded rows changed (the source revised its data)"
    return "REVISED", "sha256 differs from the manifest and no matching local original to compare (the source may have revised it)"


BACKUPS: list[tuple[Path, Path]] = []


def substitute(local: Path, fetched: Path) -> None:
    """Put the fetched copy in place for the checks, keeping the original to restore at the end."""
    backup = WORK / "originals" / local.relative_to(ROOT)
    backup.parent.mkdir(parents=True, exist_ok=True)
    if local.exists():
        shutil.copy2(local, backup)
    BACKUPS.append((local, backup))
    shutil.copy(fetched, local)


def restore_originals() -> None:
    for local, backup in BACKUPS:
        if backup.exists():
            shutil.copy2(backup, local)


def fetch_all(results: list) -> None:
    for name in PERIODS:
        fetch_period(results, name)
    # Curtailment (Elexon BOAV) and NESO constraint volumes, into the scratch folder only.
    cdir = WORK / "fetch" / "curtailment"
    rc, log, secs = run_py(f"import curtailment_check as m; m.OUT = Path({str(cdir)!r}); m.CSV = m.OUT / 'boav_wind_bids.csv'; m.fetch()")
    want = json.loads((ROOT / "analysis" / "curtailment" / "manifest.json").read_text())["sha256"]
    local = ROOT / "analysis" / "curtailment" / "boav_wind_bids.csv"
    if rc != 0:
        results.append(("fetch", "analysis/curtailment/boav_wind_bids.csv", False, f"fetch failed: {log.strip()[-160:]}", secs))
    else:
        status, detail = compare_fetched(cdir / "boav_wind_bids.csv", local, want)
        if status == "REVISED":
            substitute(local, cdir / "boav_wind_bids.csv")
            detail += "; checks run on the fetched copy, original restored at the end"
        results.append(("fetch", "analysis/curtailment/boav_wind_bids.csv", status, detail, secs))
    neso = json.loads((ROOT / "analysis" / "neso" / "manifest.json").read_text())
    dest, t0 = WORK / "fetch" / "neso.csv", time.perf_counter()
    p = subprocess.run(["curl", "-sL", neso["url"], "-o", str(dest)], capture_output=True, text=True)
    secs = time.perf_counter() - t0
    rel = f"analysis/neso/{neso['file']}"
    local = ROOT / "analysis" / "neso" / neso["file"]
    if p.returncode != 0 or not dest.exists():
        results.append(("fetch", rel, False, "download failed", secs))
    else:
        status, detail = compare_fetched(dest, local, neso["sha256"])
        if status == "REVISED":
            substitute(local, dest)
            detail += "; checks run on the fetched copy, original restored at the end"
        results.append(("fetch", rel, status, detail, secs))


def local_data(results: list) -> None:
    """--skip-fetch: check the local files against their manifests instead."""
    for name, (target, _) in PERIODS.items():
        m = json.loads((target / "manifest.json").read_text())
        bad = [m[k]["file"] for k in ("actuals", "forecasts")
               if not (target / m[k]["file"]).exists() or sha256(target / m[k]["file"]) != m[k]["sha256"]]
        results.append(("data", name, not bad, "local files match the manifest" if not bad else f"mismatch: {bad}", 0.0))
    for d, f in (("curtailment", "boav_wind_bids.csv"), ("neso", "constraint-breakdown-2025-2026.csv")):
        m = json.loads((ROOT / "analysis" / d / "manifest.json").read_text())
        ok = (ROOT / "analysis" / d / f).exists() and sha256(ROOT / "analysis" / d / f) == m["sha256"]
        results.append(("data", f"analysis/{d}", ok, "local file matches the manifest" if ok else "mismatch or missing", 0.0))


def check_doc(output: str, docs: list[str], skip: tuple[str, ...] = (), exclude: str | None = None) -> tuple[int, list[str]]:
    """Table rows: all numbers, in order, on one doc line. Prose lines: every multi-digit number somewhere in the doc."""
    text = "\n".join((ROOT / d).read_text() for d in docs)
    doc_lines = [ts for ts in (tokens(l) for l in text.splitlines()) if ts]
    doc_nums = sorted({t for ts in doc_lines for t in ts}, key=lambda t: value(t)[0])
    checked, missing = 0, []
    lines, keep, in_block = output.splitlines(), [], False
    for line in lines:   # drop the documented-exception block, if any
        if exclude and line.startswith(exclude):
            in_block = True
        elif in_block and line.startswith("## "):
            in_block = False
        if not in_block:
            keep.append(line)
    lines = keep
    for i, line in enumerate(lines):
        ts = tokens(line)
        if not ts or line.startswith(PROGRESS) or "Warning" in line or any(x in line for x in skip):
            continue   # progress lines, timings, library warnings and documented exceptions, not results
        if line.lstrip().startswith("|"):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if set(line.replace("|", "").strip()) <= set("-: ") or set(nxt.replace("|", "").strip()) <= set("-: ") and nxt.strip():
                continue   # separator or header row
            data = [t for c in cells(line) for t in tokens(c)]
            if not data:
                continue
            checked += 1
            if not any(subsequence(data, d) for d in doc_lines):
                missing.append(line.strip()[:110])
        else:
            for t in ts:
                if len(t.strip("-%.")) >= 3:
                    checked += 1
                    if not any(same(t, d) for d in doc_nums):
                        missing.append(f"{t} (from: {line.strip()[:80]})")
    return checked, missing


def run_tests(results: list) -> None:
    for name, cmd, cwd in [("backend pytest (incl. golden README numbers)", [PY, "-m", "pytest", "-q"], ROOT / "backend"),
                           ("analysis tests (leakage, CQR, make ml regeneration)", [PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "analysis/tests"], ROOT)]:
        t0 = time.perf_counter()
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
        tail = (p.stdout.strip().splitlines() or [""])[-1]
        results.append(("tests", name, p.returncode == 0, tail, time.perf_counter() - t0))


def app_only(results: list) -> None:
    """Fetch the app snapshot, check the README headline numbers on it, run the backend tests on the committed one."""
    fetched = fetch_period(results, "app snapshot (backend/data)")
    if fetched is not None:
        t0 = time.perf_counter()
        p = subprocess.run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_golden.py"], cwd=ROOT / "backend",
                           env={**os.environ, "DATA_DIR": str(fetched)}, capture_output=True, text=True)
        results.append(("check", "README headline numbers on the freshly fetched snapshot (test_golden.py)", p.returncode == 0,
                        (p.stdout.strip().splitlines() or [""])[-1], time.perf_counter() - t0))
    t0 = time.perf_counter()
    p = subprocess.run([PY, "-m", "pytest", "-q"], cwd=ROOT / "backend", capture_output=True, text=True)
    results.append(("tests", "backend pytest on the committed snapshot", p.returncode == 0,
                    (p.stdout.strip().splitlines() or [""])[-1], time.perf_counter() - t0))


def report(results: list, started: float) -> None:
    width = max(len(r[1]) for r in results)
    print(f"\n{'stage':<7} {'check':<{width}}  result   {'time':>6}  detail")
    for stage, name, ok, detail, secs in results:
        status = ok if isinstance(ok, str) else "PASS" if ok else "FAIL"
        print(f"{stage:<7} {name:<{width}}  {status:<7}  {secs:5.0f}s  {detail}")
    n_fail = sum(r[2] is False for r in results)
    n_rev = sum(r[2] == "REVISED" for r in results)
    n_ext = sum(r[2] == "EXTENDED" for r in results)
    print(f"\n{len(results) - n_fail - n_rev - n_ext} passed, {n_ext} extended and {n_rev} revised by the source, {n_fail} failed, "
          f"in {(time.perf_counter() - started) / 60:.1f} min. Outputs in {WORK.relative_to(ROOT)}/")
    sys.exit(1 if n_fail else 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-fetch", action="store_true", help="use the local analysis data instead of fetching from Elexon")
    ap.add_argument("--app-only", action="store_true", help="app snapshot only: README headline numbers and backend tests")
    args = ap.parse_args()
    (WORK / "img").mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    results: list[tuple[str, str, bool | str, str, float]] = []
    try:
        run(args, results, started)
    finally:
        restore_originals()   # local data matches the committed manifests again, whatever happened


def run(args, results: list, started: float) -> None:
    if args.app_only:
        app_only(results)
        report(results, started)

    print("1/5 data", flush=True)
    (local_data if args.skip_fetch else fetch_all)(results)

    outputs: dict[str, str] = {}
    print("2/5 studies", flush=True)
    for name, (snippet, docs) in STUDIES.items():
        rc, out, secs = run_py(snippet)
        outputs[name] = out
        (WORK / f"{name.replace(' ', '_')}.txt").write_text(out)
        if rc != 0:
            results.append(("study", name, False, f"exit {rc}: {(out.strip().splitlines() or [''])[-1][:120]}", secs))
            continue
        block, reason = EXCLUDED.get(name, (None, None))
        checked, missing = check_doc(out, docs, exclude=block)
        results.append(("study", name, not missing, f"{checked - len(missing)}/{checked} numbers found in {', '.join(docs)}"
                        + (f"; missing e.g. {missing[0]}" if missing else "") + (f"; excluded: {reason}" if reason else ""), secs))

    print("3/5 pre-registered confirmations (verify mode, not new runs)", flush=True)
    for name, (snippet, docs) in VERIFY.items():
        rc, out, secs = run_py(snippet)
        outputs[name] = out
        (WORK / f"verify_{name.split()[0]}.txt").write_text(out)
        ok, detail = rc == 0, "matches the recorded result" if rc == 0 else f"exit {rc}: {(out.strip().splitlines() or [''])[-1][:120]}"
        if ok and docs:
            checked, missing = check_doc(out, docs)
            ok = not missing
            detail += f"; {checked - len(missing)}/{checked} numbers found in {', '.join(docs)}" + (f"; missing e.g. {missing[0]}" if missing else "")
        results.append(("verify", name, ok, detail, secs))

    print("4/5 prose claims", flush=True)
    for doc, in_doc, study, in_out in CLAIMS:
        doc_ok, out_ok = in_doc in (ROOT / doc).read_text(), in_out in outputs.get(study, "")
        results.append(("claim", f"{doc}: {in_doc}", doc_ok and out_ok,
                        f"reproduced by {study}" if doc_ok and out_ok else ("doc text missing" if not doc_ok else f"not in {study} output"), 0.0))

    print("5/5 tests", flush=True)
    run_tests(results)

    report(results, started)


if __name__ == "__main__":
    main()
