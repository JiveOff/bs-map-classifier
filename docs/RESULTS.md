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

## JS pattern-only classifier ← current best (exported to ONNX)

Trained exclusively on note-level features computable from the `.dat` file — no BeatSaver metadata API required. Single source of truth: `js/lib/src/patterns.js` drives both the browser overlay and the training pipeline.

### Feature set (103 features)

**Statistical:** lane/layer histograms, direction histograms, eBPM per hand (mean/median/max/p90), timing CV, rotation mean, hand balance, double rate, crossover rate, DD rate, arc density, wall density, note density.

**Pattern counts + rates** (via `annotatePatterns()`): double, scissor, handclap, crossover\_scissor, stack, tower, loloppe, window, invert, vision\_block, dd, jump, inline, flick, triangle, hook, scoop, shrado, staircase, gallop, groove\_wall, bomb\_reset, stream (runs/notes/longest), vibro\_notes, jump\_stream (runs/notes).

### Training

- 493 maps, GradientBoosting, Optuna TPE (100 trials)
- Sample weights: balanced inverse-frequency + Extreme class boosted (Tech-side eBPM < mean → 4×, Speed-side → 2.5×), reflecting the Tier 4 Speed / Tier 4 Tech split
- `ccp_alpha = 0.0039` (post-pruning) — reduced model from ~1.9 MB → **178 KB**

**Best params:** `n_estimators=676, max_depth=3, learning_rate=0.0354, subsample=0.878, min_samples_split=13, min_samples_leaf=9, max_features=sqrt, ccp_alpha=0.00391`

### Results

5-fold CV F1: **84.57% ± 3.70%**

Per-class (hold-out test set, n=99):

| Category | Precision | Recall | F1 | Support |
|----------|-----------|--------|----|---------|
| Accuracy | 100.0% | 100.0% | **100.0%** | 18 |
| Speed | 100.0% | 90.5% | **95.0%** | 21 |
| Standard | 81.2% | 86.7% | **83.9%** | 15 |
| Tech | 95.5% | 72.4% | **82.4%** | 29 |
| **Extreme** | **62.5%** | **93.8%** | **75.0%** | 16 |

Extreme recall improved significantly (56% → 94%) via eBPM-split weighting; precision trade-off is expected given the structural overlap with Speed and Tech.

---

## Pattern Features

Note-level features extracted from actual `.dat` beatmap files via the JS annotator (`patterns.js`), which is the single source of truth for all pattern detection logic.

**Slot-based:** double, scissor, handclap, crossover\_scissor, stack, tower, loloppe, window

**Per-note:** invert, vision\_block, dot\_note, top\_row\_note, crossover

**Sequential (per-hand):** dd, jump, inline, flick, hook, scoop, shrado, staircase, arm\_circle, triangle, paul, dot\_spam

**Stream / multi-note:** stream, vibro\_stream, jump\_stream, gallop, piano\_stream, croissant

**Obstacle:** groove\_wall

**Bomb:** bomb\_reset, bomb\_hold, hammer\_hit

Plus statistical features: lane/layer histograms, direction histograms, eBPM per hand, timing CV, rotation, arc rates, wall density.

---

## Key Findings

- **Unified JS pipeline**: `patterns.js` is the single source of truth — the same annotator runs in the browser overlay and generates training features, eliminating drift between inference and training.
- **eBPM dominates**: `ebpm_left_mean` and `ebpm_right_mean` together account for ~10% of feature importance — the single strongest signal for Speed vs everything else.
- **Extreme is structurally bimodal**: Tier 4 Speed (>400 BPM) looks like Speed; Tier 4 Tech looks like Tech. eBPM-split sample weighting (4× for Tech-side, 2.5× for Speed-side) raised Extreme recall from 56% → 94%.
- **Model size**: `ccp_alpha` pruning cut the ONNX model from 1.9 MB to 178 KB with no meaningful accuracy loss.
- **Full CV F1 progression**: 64.3% (metadata only) → 82.97% (JS pattern pipeline, untuned) → 84.03% (+ Extreme weighting) → **84.57%** (+ Optuna tuning, 100 trials).
- **Accuracy and Speed are cleanest**: near-perfect F1 — arc/chain rates and eBPM signals are unambiguous.
- **Standard is the second hardest**: 83.9% F1 — acts as a catch-all for maps that don't strongly exhibit any single category's signal.
