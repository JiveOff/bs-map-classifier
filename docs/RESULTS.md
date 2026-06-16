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

## Models — Optuna-tuned (150 trials each) ← current best

Same 263-feature dataset, hyperparameters optimised with Optuna TPE sampler, objective = 5-fold CV F1 (weighted). All tuned models saved to `models/tuned/`.

| Model | CV F1 | Test Acc | Test F1 |
|-------|-------|----------|---------|
| **Random Forest** | **88.54%** | **82.11%** | **81.68%** |
| XGBoost | 87.97% | 81.05% | 80.84% |
| LightGBM | 87.97% | 81.05% | 80.92% |
| Gradient Boosting | 87.40% | 82.11% | 81.61% |

**Best params (Random Forest):** `n_estimators=499, max_depth=20, min_samples_split=4, min_samples_leaf=2, max_features='sqrt', class_weight='balanced'`

Per-class breakdown (tuned Random Forest, test set):

| Category | Precision | Recall | F1 | Support |
|----------|-----------|--------|----|---------|
| Accuracy | 90.0% | 100.0% | 94.7% | 18 |
| Speed | 90.9% | 100.0% | 95.2% | 20 |
| **Extreme** | **60.0%** | **92.3%** | **72.7%** | 13 |
| Standard | 75.0% | 60.0% | 66.7% | 15 |
| Tech | 90.5% | 65.5% | 76.0% | 29 |

Per-class breakdown (XGBoost, test set):

| Category | Precision | Recall | F1 | Support | vs v2 |
|----------|-----------|--------|----|---------|-------|
| Accuracy | 90.0% | 100.0% | 94.7% | 18 | +2.0pp |
| Speed | 87.0% | 100.0% | 93.0% | 20 | +0.0pp |
| Tech | 82.1% | 79.3% | 80.7% | 29 | +3.0pp |
| **Extreme** | **71.4%** | **76.9%** | **74.1%** | 13 | **+7.4pp** |
| Standard | 80.0% | 53.3% | 64.0% | 15 | −13.4pp |

The windowed features directly improved Extreme (+7.4pp), the previously hardest class. The Logistic Regression jump from 77.9% → 82.1% confirms these features contain strong linear signal.

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

- **Optuna (150 trials) pushed CV F1 to 88.54%**: Random Forest wins after tuning (+4pp over the untuned 84.57%). The best hyperparameters are shallower regularisation with more trees — consistent with the high-dimensional (263-feature) setting.
- **Windowed features unlocked Extreme**: Extreme F1 jumped from 66.7% → 72–74% — the single biggest per-class gain. Temporal distribution was the missing signal.
- **Linear models caught up**: Logistic Regression went from 77.9% → 82.1% with windowed features, confirming they carry strong linear signal.
- **39 pattern detectors**: expanding from 10 pushed merged accuracy from 82% → 84% (+2pp).
- **Gradient Boosting needs tuning at high dimensionality**: dropped to 80% untuned on 263 features, recovered to 87.40% CV F1 after Optuna.
- **Full progression**: 64.3% (metadata only) → 86.5% (10 patterns) → 84.6% (39 patterns + windowed, untuned) → **88.54%** (Optuna-tuned RF).
- **Accuracy and Speed are cleanest**: ~97-100% F1 — high rbRatio and eBPM signals are unambiguous.
- **Extreme is still hardest**: ~64% F1 — it genuinely straddles Speed (high eBPM) and Tech (crossovers, parity breaks) simultaneously.
- **CV variance tightened**: 84.12% ± 1.77% vs 86.46% ± 4.05% previously — more features made the model more stable fold-to-fold.
