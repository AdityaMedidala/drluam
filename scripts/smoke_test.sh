#!/usr/bin/env bash
# Smoke test a deployed copy of the app: API routes return the expected data
# and the page HTML loads. Usage: scripts/smoke_test.sh https://drluam.vercel.app
# For a protected preview, set VERCEL_PROTECTION_BYPASS to the project's bypass secret.
set -uo pipefail

BASE="${1:?usage: $0 <url>}"
BASE="${BASE%/}"
HEADERS=()
if [[ -n "${VERCEL_PROTECTION_BYPASS:-}" ]]; then
  HEADERS=(-H "x-vercel-protection-bypass: ${VERCEL_PROTECTION_BYPASS}")
fi

failures=0

# check <name> <path> <pattern>: GET the path, expect HTTP 200 and the pattern in the body.
check() {
  local name="$1" path="$2" pattern="$3" body status
  body="$(curl -sS --max-time 60 -w '\n%{http_code}' ${HEADERS[@]+"${HEADERS[@]}"} "${BASE}${path}")"
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$status" == "200" ]] && grep -q -- "$pattern" <<<"$body"; then
    echo "ok    $name"
  else
    echo "FAIL  $name ($path): HTTP $status, expected /$pattern/"
    echo "      ${body:0:200}"
    failures=$((failures + 1))
  fi
}

check health   "/api/health"                                          '"status":"ok"'
check meta     "/api/meta"                                            '"representativeDelivery":"2026-01-17"'
check day      "/api/day?date=2026-01-17&cutoff=09:20"                '"decisionTimeUtc":"2026-01-16T09:20:00Z"'
check plan     "/api/plan?date=2026-01-17&cutoff=09:20&confidence=80" '"date":"2026-01-17"'
check accuracy "/api/accuracy?cutoff=09:20"                           '"cutoff":"09:20"'
check page     "/?date=2026-01-17"                                    '<div id="root">'

if (( failures )); then
  echo "$failures check(s) failed against $BASE"
  exit 1
fi
echo "all checks passed against $BASE"
