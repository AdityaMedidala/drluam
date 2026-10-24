# Time log

Clock time I spent on the challenge, in IST (UTC+05:30). AI assistants (Claude in claude.ai and Claude Code) did most of the implementation. The hours below are my wall-clock time directing, reviewing and deciding, not compute time.

**Core build** is the work the brief asks for: the app, the analysis in the app, tests, Docker and deployment. **Extra analysis** is work beyond the brief's scope: multi-month validation, error anatomy, uncertainty and correction experiments, and prior-art research. The README reports the two separately.

## Sat 24 Oct 2026

| Time (IST) | Hours | Track | What |
|---|---|---|---|
| 09:24–09:35 | 0.2 | Core | Read the brief. Researched GB day-ahead market timing. Made the plan (phases, cutoff logic, delivery days 2 Jan – 1 Feb). Wrote the Elexon fetch and explore scripts. Fetched the January data. |
| 09:35–09:56 | 0.35 | Core | First full build: FastAPI backend (decision-forecast selection, 7-day ratio correction, metrics), React + Recharts frontend (Decision and Accuracy views), Dockerfiles, docker-compose, Vercel config, README, 13 tests. |
| 09:56–10:12 | 0.25 | Core | First Docker run (port clash on 8080, made ports configurable). Set up the Claude Code review setup. Ran the independent domain, numbers and code reviews. Researched curtailment and desk practice. Triaged the findings. |
| 10:12–10:35 | 0.4 | Core | Fixed the review findings, one commit each: refetched data with December history; a leakage rule (actual known only after its half-hour ends); an out-of-sample band with measured coverage; an "already elapsed" lead-time bucket; the same hours for raw vs adjusted; robustness (startup load, cutoff validation, NaN/inf, stale UI, pinned dependencies, DST test); README copy and a golden-numbers test. |
| 10:35–10:53 | 0.3 | Extra | Validated on Nov 2025 – Mar 2026, then a pre-registered holdout on Apr–Sep 2026. Error anatomy (level vs timing, ramps, high-wind flattening, run disagreement, worst days). Pre-registered uncertainty-band test: no candidate passed. |
| 10:53–11:20 | 0.45 | Extra | Pre-registered a level-aware correction, tested once on the untouched Jan–Oct 2025 vault: failed (3 of 10 months), kept the simpler method. Prior-art deep research (public submissions, IEA/Messner evaluation standards, post-processing literature, GB data and market context). |
| 11:20–13:05 | _fill in_ | _fill in_ | _What I did in this window, if anything (e.g. applied the prior-art fixes: 09:20/09:50 cutoffs, wording, skill score, bootstrap CI). Write 0 if it was a break._ |
| 13:05–13:15 | 0.15 | Core | Master plan for the remaining work (PLAN.md), time log, git author fix. |

**Total so far (excluding the 11:20–13:05 window):** about 2.1 h, of which about 1.35 h core and 0.75 h extra.

## Running totals

| | Core build | Extra analysis | Total |
|---|---|---|---|
| Sat 24 Oct | ~1.35 h | ~0.75 h | ~2.1 h |
| **Cumulative** | **~1.35 h** | **~0.75 h** | **~2.1 h** |

_Add a row per session. Video scripting, rehearsal and recording count as core: the brief requires the video._
