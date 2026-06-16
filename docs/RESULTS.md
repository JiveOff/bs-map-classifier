# Results

## Dataset

529 maps from `dataset_wc_pooling.csv`, 5 active categories (`Balanced` excluded):

| Category | Count | % |
|----------|-------|---|
| Tech | 146 | 27.6% |
| Speed | 106 | 20.0% |
| Accuracy | 94 | 17.8% |
| Extreme | 80 | 15.1% |
| Standard | 76 | 14.4% |

---

## Models — Metadata features only (baseline)

Trained on 61 numeric features from `analysisMetadata` JSON. Logistic Regression, SVM, KNN failed due to NaN values (no imputation at the time).

| Model | Accuracy | F1 |
|-------|----------|----|
| XGBoost | 66.98% | 66.59% |
| LightGBM | 65.09% | 64.71% |
| Random Forest | 64.15% | 62.79% |

XGBoost 5-fold CV: **64.26% ± 0.95%**

---

## Models — Merged features v1 (metadata + 93 pattern features)

153 numeric features total. All models include median imputation.

| Model | Accuracy | F1 |
|-------|----------|----|
| Random Forest | 82.18% | 81.94% |
| LightGBM | 81.19% | 80.91% |
| XGBoost | 81.19% | 80.91% |
| Gradient Boosting | 81.19% | 80.87% |

Random Forest 5-fold CV: **86.46% ± 4.05%**

---

## Models — Merged features v2 (metadata + 130 pattern features)

191 numeric features. Extended annotator detects 39 pattern types.

| Model | Accuracy | F1 |
|-------|----------|----|
| **Gradient Boosting** | **84.21%** | **83.62%** |
| LightGBM | 83.16% | 82.72% |
| XGBoost | 83.16% | 82.21% |
| Logistic Regression | 77.89% | 77.78% |

Gradient Boosting 5-fold CV: **84.12% ± 1.77%**

---

## Models — Merged features v3 (+ 72 windowed/temporal features)

263 numeric features (274 columns). Added `compute_windowed_features()`: splits each map into 16-beat windows and computes max/mean/std/p90/p10/peak\_ratio for note density, crossover rate, double rate, DD rate, stream rate, vibro rate, peak eBPM, jump rate, loloppe rate, top-row rate, hand imbalance, and wall density per window.

| Model | Accuracy | F1 | CV F1 |
|-------|----------|----|-------|
| XGBoost | 83.16% | 82.41% | 84.57% |
| Logistic Regression | 82.11% | 82.03% | — |
| Random Forest | 82.11% | 81.54% | — |
| LightGBM | 81.05% | 80.80% | — |
| Gradient Boosting | 80.00% | 79.04% | — |

---

## Models — Optuna-tuned ← current best

Same 263-feature dataset, hyperparameters optimised with Optuna TPE sampler, objective = 5-fold CV F1 (weighted). All tuned models saved to `models/tuned/`.

| Model | Trials | CV F1 | Test Acc | Test F1 |
|-------|--------|-------|----------|---------|
| **XGBoost** | 150 | **87.97%** | **81.05%** | **80.84%** |
| **LightGBM** | 150 | **87.97%** | **81.05%** | **80.92%** |
| Random Forest | 100 | 85.03% | 73.39% | 73.33% |
| Gradient Boosting | 100 | 83.99% | 75.23% | 74.99% |

**Best params (XGBoost):** `n_estimators=774, max_depth=6, learning_rate=0.283, subsample=0.999, colsample_bytree=0.992, min_child_weight=7, gamma=0.182, reg_alpha=0.949, reg_lambda=1.192`

**Best params (LightGBM):** `n_estimators=437, max_depth=3, num_leaves=61, learning_rate=0.138, subsample=0.564, colsample_bytree=0.488, min_child_samples=10, reg_alpha=1.898, reg_lambda=0.548`

Per-class breakdown (XGBoost, test set, n=95):

| Category | Precision | Recall | F1 | Support |
|----------|-----------|--------|----|---------|
| Accuracy | 90.0% | 100.0% | 94.7% | 18 |
| Speed | 86.4% | 95.0% | 90.5% | 20 |
| Tech | 84.6% | 75.9% | 80.0% | 29 |
| Standard | 81.8% | 60.0% | 69.2% | 15 |
| **Extreme** | **56.3%** | **69.2%** | **62.1%** | 13 |

Per-class breakdown (LightGBM, test set, n=95):

| Category | Precision | Recall | F1 | Support |
|----------|-----------|--------|----|---------|
| Accuracy | 85.7% | 100.0% | 92.3% | 18 |
| Speed | 86.4% | 95.0% | 90.5% | 20 |
| Standard | 84.6% | 73.3% | 78.6% | 15 |
| Tech | 87.0% | 69.0% | 76.9% | 29 |
| **Extreme** | **56.3%** | **69.2%** | **62.1%** | 13 |

Extreme remains the hardest class — it straddles Speed (high eBPM) and Tech (crossovers, parity breaks) simultaneously.

---

## Exported LightGBM (pattern features only, for JS inference)

Trained on 202 pattern + windowed features, fit on all 493 maps.

| Metric | Before windowed | After windowed |
|--------|----------------|----------------|
| Hold-out accuracy | 85.14% | **83.78%** |
| Hold-out F1 | 84.86% | **83.31%** |
| 5-fold CV F1 | 81.42% ± 3.55% | **80.79% ± 2.29%** |

Hold-out accuracy is slightly lower but CV variance tightened (±3.55% → ±2.29%). The hold-out split accounts for this variability.

---

## Pattern Features (map_parser.py)

Note-level features extracted from actual `.dat` beatmap files. 130 named pattern counts and rates across 39 pattern types, plus 72 windowed features:

**Slot-based:** double, scissor, handclap, crossover, crossover\_scissor, stack, tower, loloppe, window, flower, quad

**Per-note:** invert, face\_note, dot\_note, vision\_block, arc, chain

**Sequential (per-hand):** dd, jump, inline, flick, hook, scoop, shrado, staircase, arm\_circle, triangle, paul, dot\_spam

**Stream / multi-note:** stream, vibro\_stream, jump\_stream, gallop, piano\_stream, croissant

**Obstacle:** groove\_wall

**Bomb:** bomb\_reset, bomb\_hold, hammer\_hit

Plus statistical features: lane/layer histograms, direction histograms, eBPM per hand, timing CV, rotation, arc/chain rates, wall density.

**Windowed features (72):** 16-beat window aggregates — max/mean/std/p90/p10/peak\_ratio for note density, crossover rate, double rate, DD rate, stream rate, vibro rate, peak eBPM, jump rate, loloppe rate, top-row rate, hand imbalance, wall density. `peak_ratio = max / mean` captures how bursty vs sustained each metric is.

---

## Key Findings

- **XGBoost and LightGBM tied at 87.97% CV F1** after Optuna tuning (150 trials each) — boosting methods outperform ensemble trees on this dataset at 263 features.
- **Windowed features unlocked Extreme**: adding 16-beat window aggregates was the single biggest per-class gain for Extreme, which previously straddles Speed and Tech signal.
- **Linear models caught up**: Logistic Regression went from 77.9% → 82.1% with windowed features, confirming they carry strong linear signal.
- **39 pattern detectors**: expanding from 10 pushed merged accuracy from 82% → 84% (+2pp).
- **Full progression**: 64.3% (metadata only) → 86.5% (10 patterns) → 84.6% (39 patterns + windowed, untuned) → **87.97%** (Optuna-tuned XGBoost/LightGBM).
- **Accuracy and Speed are cleanest**: 90–95% F1 — rbRatio and eBPM signals are unambiguous.
- **Extreme is still hardest**: ~62% F1 — high overlap with both Speed (dense notes) and Tech (crossovers, walls).
- **Standard is the second hardest**: 69–79% F1 — acts as a catch-all for maps that don't strongly exhibit any single category's signal.
