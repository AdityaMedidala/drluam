# Developer shortcuts (run `make help`). Analysis targets need `pip install -r analysis/requirements.txt`;
# the app itself never needs LightGBM.
PY ?= python

.PHONY: help dev test data ml smoke reproduce reproduce-app

help:  ## list the targets
	@grep -E '^[a-z]+:.*## ' Makefile | sed -E 's/:.*## /\t/'

dev:  ## backend on :8000 (reload) and frontend on :5173, which proxies /api; Ctrl-C stops both
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

test:  ## backend pytest, analysis tests (incl. make ml regeneration), Playwright e2e with axe
	cd backend && $(PY) -m pytest -q
	$(PY) -m pytest -q -p no:cacheprovider analysis/tests
	cd frontend && npx playwright test

data:  ## re-fetch the app's January snapshot from Elexon into backend/data (rewrites its manifest)
	$(PY) backend/scripts/fetch_data.py

ml:  ## regenerate backend/data/ml_predictions.csv and ml_development.json (ADR-001)
	$(PY) analysis/ml_export.py

smoke:  ## smoke-test a deployment: make smoke URL=https://drluam.vercel.app
	@test -n "$(URL)" || { echo "usage: make smoke URL=https://..."; exit 2; }
	bash scripts/smoke_test.sh $(URL)

reproduce:  ## fetch every period from Elexon, rerun every study, check the documented numbers; pass/fail table
	$(PY) analysis/reproduce.py

reproduce-app:  ## fast check: fetch the app snapshot, check the README headline numbers on it, run the backend tests
	$(PY) analysis/reproduce.py --app-only
