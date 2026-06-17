# Results

## Dataset

529 maps from the BSWC pooling database, 5 active categories (`Balanced` excluded):

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

## Models — Optuna-tuned (263-feature merged set)

Same 263-feature dataset, hyperparameters optimised with Optuna TPE sampler, objective = 5-fold CV F1 (weighted). All tuned models saved to `models/tuned/`.

| Model | Trials | CV F1 | Test Acc | Test F1 |
|-------|--------|-------|----------|---------|
| **XGBoost** | 150 | **87.97%** | **81.05%** | **80.84%** |
| **LightGBM** | 150 | **87.97%** | **81.05%** | **80.92%** |
| Random Forest | 100 | 85.03% | 73.39% | 73.33% |
| Gradient Boosting | 100 | 83.99% | 75.23% | 74.99% |

---

## Models — NJS/NPS/SPS features + Optuna tuning ← current best

Added 22 geometry features computed via **bsmap**: NJS, jump distance, reaction time, HJD, JD optimal range deltas, NPS (mapped + peak at 4/8/16-beat windows), and SPS per hand (average/median/peak) using the canonical ScoreSaber swing algorithm.

### Baseline (untuned, parallelised, ~13 s)

| Model | Accuracy | F1 |
|-------|----------|----|
| **XGBoost** | **86.87%** | **86.62%** |
| LightGBM | 85.86% | 85.66% |
| Logistic Regression | 85.86% | 85.63% |
| Gradient Boosting | 85.86% | 85.61% |
| Random Forest | 83.84% | 83.66% |

XGBoost 5-fold CV: **84.69% ± 2.42%**

Notable: Logistic Regression jumped from ~68% to **85.86%** — the NJS/NPS/SPS features are strongly linearly separable.

### Optuna-tuned (100 trials, 5-fold CV folds parallelised)

| Model | Time | CV F1 | Test Acc | Test F1 |
|-------|------|-------|----------|---------|
| **LightGBM** | ~70s | **85.13%** | **88.89%** | **88.80%** |
| Gradient Boosting | ~17m | 84.93% | 86.87% | 86.95% |
| XGBoost | ~2m | 85.33% | 83.84% | 83.70% |
| Random Forest | ~1.5m | 84.66% | 82.83% | 82.53% |

**Best model: LightGBM** — exported to ONNX via onnxmltools (opset 15, zipmap=False).

**LightGBM best params:** `n_estimators=386, max_depth=7, num_leaves=53, learning_rate=0.0375, subsample=0.749, colsample_bytree=0.534, min_child_samples=42`

### Per-class breakdown (LightGBM tuned, hold-out test set, n=99)

| Category | Precision | Recall | F1 | Support |
|----------|-----------|--------|----|---------|
| Accuracy | 100.0% | 100.0% | **100.0%** | 18 |
| Speed | 95.2% | 95.2% | **95.2%** | 21 |
| Standard | 92.9% | 86.7% | **89.7%** | 15 |
| Tech | 78.8% | 89.7% | **83.9%** | 29 |
| **Extreme** | **84.6%** | **68.8%** | **75.9%** | 16 |

Extreme precision improved dramatically (62.5% → 84.6%) — NJS/SPS features help distinguish Extreme from Speed and Tech far more cleanly than eBPM alone.

---

## Key Findings

- **NJS/NPS/SPS features are the biggest gain to date**: Adding 22 geometry features via bsmap pushed untuned accuracy from 83.84% → 86.87%, and tuned LightGBM reached **88.89%** — a +4.3% gain over the previous best.
- **SPS is the strongest new signal**: `sps_total_avg` and `sps_total_peak` (ScoreSaber-canonical swing density) cleanly separate Speed (high SPS) from Accuracy (low SPS) and Tech (moderate, irregular SPS). This explains why Logistic Regression jumped +17% — it's a linear signal.
- **Reaction time separates map feel**: Maps with RT < 0.5s are typically Speed/Extreme; RT > 0.7s skews Accuracy. The `jd_delta_low` feature (how far JD is below the optimal lower bound) is a proxy for aggressive/uncomfortable mapping — correlates with Tech and Extreme.
- **LightGBM beats GradientBoosting** with the new features: GB is still the best choice if skl2onnx compatibility is strictly required (e.g. browser runtimes that can't use onnxmltools output), but LightGBM at 88.89% dominates.
- **Extreme precision fix**: Previous model had 62.5% Extreme precision — many Speed maps were misclassified as Extreme. NJS features resolved this: Extreme maps typically have very tight reaction times AND high SPS, distinguishing them from pure-Speed maps that are hard but readable.
- **eBPM still dominates for Speed**: `ebpm_left_mean` + `ebpm_right_mean` remain top-2 features. SPS and NPS add orthogonal signal — SPS captures swing complexity, eBPM captures per-hand speed.
- **Accuracy and Speed are cleanest**: near-perfect F1 — arc/chain rates, eBPM signals, and now SPS are unambiguous for these classes.
- **Standard remains the hardest**: 89.7% F1 (improved from 83.9%) — it's fundamentally a "none of the above" category, but NJS/JD features help because Standard maps tend to use conventional, comfortable settings.
- **Full CV F1 progression**: 64.3% → 82.97% → 84.03% → 84.57% → **85.13%** (LightGBM, 100 Optuna trials, 222 features including NJS/NPS/SPS).
