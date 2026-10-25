# Developer shortcuts. `make ml` needs the analysis data (gitignored, see README) and
# `pip install -r analysis/requirements-ml.txt`; the app itself never needs LightGBM.

.PHONY: ml

ml:  ## regenerate backend/data/ml_predictions.csv and ml_development.json (ADR-001)
	python analysis/ml_export.py
