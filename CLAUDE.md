# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ML classifier for Beat Saber custom maps into 5 categories: **Tech, Speed, Accuracy, Standard, Extreme**.

The **primary goal** is to classify maps from their actual note data — the physical patterns a player must hit — not just summary metadata. The metadata features (from `analysisMetadata` JSON in the CSV) are a fast baseline; the pattern features (from parsing the `.dat` files inside downloaded map zips) are the main signal.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
brew install libomp  # macOS only, required for XGBoost
```

## Commands

```bash
# 1. Download actual map zips from BeatSaver (required for pattern features)
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --limit 50
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --category Speed

# 2. Parse downloaded maps and extract statistical features (eBPM, rotation, histograms, etc.)
python src/data/map_parser.py --maps data/raw/maps --output data/processed/pattern_features.csv

# 3. Run JS annotator to extract named pattern counts + NJS/NPS/SPS features.
#    Requires Node.js ≥18 and `pnpm install` in js/lib/.
#    Merges JS output with map_parser.py statistical features.
python src/data/pattern_features_js.py \
    --maps data/raw/maps \
    --base-features data/processed/pattern_features.csv \
    --output data/processed/pattern_features_merged.csv

# 4. Train all baseline models (parallelised, ~13 s)
python src/models/baseline.py \
    --features data/processed/pattern_features_merged.csv \
    --output models/baseline_models \
    --cross_validate

# 5. Hyperparameter tuning with Optuna (100 trials per model, 5-fold CV folds parallelised)
#    Tunes: LightGBM, XGBoost, RandomForest, GradientBoosting
python src/models/tune.py \
    --features data/processed/pattern_features_merged.csv \
    --trials 100

# 6. Export best model to ONNX (used by the JS/browser inference pipeline)
python src/models/export_onnx.py --maps data/raw/maps
```

JS library tests (run from `js/lib/`):
```bash
pnpm install          # install bsmap + dev deps
node --test tests/*.test.js
```

## Architecture

### Full Pipeline

```
dataset_wc_pooling.csv (529 maps, with header row)
    │
    └─► src/data/downloader.py ──► data/raw/maps/<category>/<key>/
        (downloads .zip from BeatSaver, extracts all difficulties,
         saves _dataset.json with characteristic/difficulty/bpm)
            │
            ├─► src/data/map_parser.py ──► data/processed/pattern_features.csv
            │   (statistical features only: eBPM, rotation, lane/layer histograms,
            │    timing CV, windowed features, obstacle/arc density)
            │
            ├─► js/lib/scripts/annotate_batch.js  (Node.js, uses bsmap)
            │   (canonical JS annotator → named pattern counts + NJS/NPS/SPS geometry:
            │    n_double, n_hook, n_inline, njs, jump_distance, reaction_time,
            │    nps_mapped, peak_nps_4/8/16beat, sps_total/red/blue_{avg,median,peak})
            │
            └─► src/data/pattern_features_js.py
                (calls annotate_batch.js, merges JS output + map_parser stats)
                    │
                    └─► data/processed/pattern_features_merged.csv
                            │
                            ├─► src/models/baseline.py ──► models/baseline_models/*.pkl
                            │   (7 models, parallelised, ~13 s)
                            │
                            └─► src/models/tune.py ──► models/tuned/*.pkl
                                (Optuna TPE, 100 trials, 5-fold CV folds parallel)
                                    │
                                    └─► src/models/export_onnx.py
                                        (GradientBoosting → skl2onnx
                                         LightGBM/XGBoost → onnxmltools opset 15)
                                             │
                                             └─► models/onnx/pattern_classifier.onnx
                                                 js/lib/models/pattern_classifier.onnx
```

### CSV Column Names

`dataset_wc_pooling.csv` has a proper header row. Key columns:
- `category_name`: classification target (Tech, Speed, Accuracy, Standard, Extreme) — `Balanced` excluded at load time in both `features_v2.py` and `downloader.py`
- `key`: BeatSaver short hex ID (e.g. `"2b120"`) — used for API calls and map directory names
- `analysisMetadata`: embedded JSON string, may be double-escaped — parsed via fallback chain in `parse_json_metadata()`
- `characteristic`: game mode (almost always `"Standard"`)
- `difficulty`: difficulty name (`"ExpertPlus"`, `"Expert"`, etc.) — determines which `.dat` file to parse
- `length`: note count (confusingly named)
- `bpm`: song BPM — required for eBPM calculation in the pattern parser

### Metadata Feature Extraction (`src/data/features_v2.py`)

`FeatureExtractor.extract_features_from_row()` pulls three layers:
1. **CSV columns**: BPM, NPS, note_count, ranked/qualified flags
2. **JSON `bsmap` key**: NPS peaks (4th/8th/16th notes), SPS (swings-per-second) for red/blue/total, note counts, obstacle counts, map settings (NJS, jumpDistance, reactionTime), note information (eBPM, rbRatio, sliderSpeed)
3. **JSON `beatSaverParity` key**: parity warns/errors/resets
4. **Derived**: ratios (bomb_per_note, obstacle_per_note), composite indicators (complexity, speed, tech, accuracy)

### Map Downloader (`src/data/downloader.py`)

Downloads from `https://beatsaver.com/api/maps/id/{key}` and extracts the zip. Each map lands at `data/raw/maps/<category_name>/<key>/`. Two sidecar files are written:
- `_beatsaver.json`: full API response (contains all version hashes, download URLs)
- `_dataset.json`: the CSV row fields needed by the parser — `characteristic`, `difficulty`, `bpm`, `hash`

The zip contains **all difficulties**. `map_parser.py` reads `_dataset.json` to know which `.dat` to analyse.

### Statistical Feature Extraction (`src/data/map_parser.py`)

Parses the actual `.dat` beatmap file and computes **signal-level statistical features** only. Named pattern counts are handled separately by the JS annotator.

**Grid reference** (from `wiki/wiki/mapping/map-format/beatmap.md`):
- Lanes (x): 0=far-left, 1=centre-left, 2=centre-right, 3=far-right
- Layers (y): 0=bottom, 1=middle, 2=top
- Cut direction: 0=Up, 1=Down, 2=Left, 3=Right, 4=UpLeft, 5=UpRight, 6=DownLeft, 7=DownRight, 8=Any(dot)

**Supports beatmap format v2** (`_notes`, `_obstacles`, `_sliders` keys) **and v3/v4** (`colorNotes`, `obstacles`, `burstSliders` etc.). File is located via `Info.dat` → `_difficultyBeatmapSets` (v2) or `difficultyBeatmaps` (v4).

**Statistical features** (from `compute_pattern_features()`):

| Feature group | Features | Category signal |
|---|---|---|
| Lane/layer histograms | `lane_{0-3}_rate`, `layer_{0-2}_rate`, `top_row_rate` | Top-row heavy → Tech/Extreme |
| Direction histograms | `dir_{0-8}_rate`, `dot_note_rate` | Dot-heavy → Speed streams |
| Hand balance | `left_note_rate`, `hand_imbalance` | Imbalanced → Tech |
| Parity (DD rate) | `dd_rate_left/right/total` | High → Tech; Low → Accuracy/Speed |
| eBPM per hand | `ebpm_left/right_{mean,median,max,p90}`, `ebpm_max_overall` | High → Speed/Extreme |
| Timing variability | `interval_cv_left/right` | Low → Speed streams; High → Tech |
| Rotation | `rotation_mean_left/right/total` | High → Tech; Low → Speed |
| Arcs/chains | `arc_rate`, `chain_rate` | Arc-heavy → Accuracy |
| Obstacles | `dodge_wall_count/rate`, `crouch_wall_count/rate`, `wall_density` | Walls → Tech/Extreme |
| Windowed (16-beat windows) | `win_*_{max,mean,std,p90,peak_ratio}` | Temporal distribution of each metric |

**eBPM formula**: `ebpm = bpm * 0.5 / per_hand_interval_beats` — at 1/4 stream (interval=0.5 beats) eBPM equals song BPM, matching the BSMG wiki definition.

### Named Pattern Counts + Geometry Features (`js/lib/scripts/annotate_batch.js` + `src/data/pattern_features_js.py`)

The **JS annotator** (`js/lib/src/patterns.js`) is the single source of truth for named pattern detection. `annotate_batch.js` runs it over all downloaded maps and outputs per-map counts plus geometry features. `pattern_features_js.py` calls it via subprocess and merges the output into the statistical features CSV.

**Geometry features** (from `bsmap`'s `NoteJumpSpeed` class and swing module — no `js_` prefix, canonical names for training/inference parity):

| Feature group | Features | Notes |
|---|---|---|
| NJS / jump | `njs`, `njs_offset`, `jump_distance`, `reaction_time`, `hjd` | From Info.dat via `findDatInfo()` |
| JD optimal | `jd_optimal_low`, `jd_optimal_high`, `jd_delta_low`, `jd_delta_high` | bsmap `NoteJumpSpeed.calcJdOptimal()` |
| NPS | `nps_mapped`, `peak_nps_4beat`, `peak_nps_8beat`, `peak_nps_16beat` | Notes/second (not notes/beat) |
| SPS | `sps_total/red/blue_{avg,median,peak}` | ScoreSaber-canonical swing algorithm via `bsmap/extensions/swing` |

Pattern counts produced (each also has a `_rate` variant normalised by note count):

| Pattern | JS count column | Category signal |
|---|---|---|
| Stream | `js_n_stream` | High → Speed |
| Vibro stream | `js_n_vibro_stream` | High → Speed/Extreme |
| Double | `js_n_double` | High → Standard/Extreme |
| Scissor | `js_n_scissor` | Present → Tech/Accuracy |
| Stack | `js_n_stack` | High → Standard/Extreme |
| Tower | `js_n_tower` | High → Extreme |
| Crossover | `js_n_crossover` | High → Tech |
| Crossover Scissor | `js_n_crossover_scissor` | High → Tech |
| DD (parity break) | `js_n_dd` | High → Tech |
| Triangle | `js_n_triangle` | Present → Tech |
| Inline | `js_n_inline` | High → Tech |
| Jump | `js_n_jump` | High → Speed/Extreme |
| Invert | `js_n_invert` | High → Accuracy/Tech |
| Flick | `js_n_flick` | High → Speed |
| Gallop | `js_n_gallop` | Present → Standard/Extreme |
| Quad | `js_n_quad` | Rare → Extreme |
| Paul | `js_n_paul` | Rare → Tech |
| Face note | `js_n_face_note` | High → Tech/Extreme |
| Dot note | `js_n_dot_note` | High → Speed/Standard |
| Hook | `js_n_hook` | Present → Standard/Tech |
| Window | `js_n_window` | Present → Standard/Extreme |
| Handclap | `js_n_handclap` | Present → Aggressive mapping |
| Vision block | `js_n_vision_block` | Present → Tech/Extreme |
| Loloppe | `js_n_loloppe` | Present → Tech |
| Flower | `js_n_flower` | Rare → Accuracy |
| Bomb reset | `js_n_bomb_reset` | Present → Tech |
| Bomb hold | `js_n_bomb_hold` | Present → Extreme |
| Hammer hit | `js_n_hammer_hit` | Present → Extreme/Tech |

### Model Training (`src/models/baseline.py`)

Trains 7 algorithms (LogisticRegression, RandomForest, XGBoost, LightGBM, DecisionTree, SVM, KNN) in **parallel** (`joblib.Parallel`). Drops non-numeric and ID columns; applies `SimpleImputer(median)` + `StandardScaler` + `LabelEncoder`. Explicitly drops any remaining `Balanced` rows. Runs in ~13 s.

**Current best** (untuned): XGBoost — **86.87% accuracy, 86.62% F1** (5-fold CV: 84.69% ± 2.42%).
**Current best** (tuned): LightGBM — **88.89% accuracy, 88.80% F1** (CV F1: 85.13%).

### Hyperparameter Tuning (`src/models/tune.py`)

Runs Optuna TPE Bayesian optimisation over 4 models (LightGBM, XGBoost, RandomForest, GradientBoosting), 100 trials each. Objective: 5-fold CV F1 (weighted) with eBPM-split sample weights for the Extreme class. CV folds are parallelised (`joblib.Parallel(n_jobs=5)`); LightGBM/XGBoost/RF use `n_jobs=1` per fold to avoid nested parallelism.

- LightGBM: ~70s (fastest, also best model — 88.89% test acc after tuning)
- XGBoost: ~2 min
- RandomForest: ~1.5 min
- GradientBoosting: ~17 min (single-threaded per tree; best if strict skl2onnx compat needed)

All 4 models can be exported to ONNX:
- GradientBoosting / RandomForest → `skl2onnx` (native sklearn)
- LightGBM / XGBoost → `onnxmltools` (opset 15)

### Directory Layout

```
src/data/
  downloader.py           # BeatSaver map downloader
  map_parser.py           # .dat parser → statistical features (eBPM, rotation, etc.)
  pattern_features_js.py  # calls JS annotator, merges output into training CSV
  features_v2.py          # legacy metadata feature extraction (not used in current pipeline)
  pattern_annotator.py    # per-note pattern labelling for the HTML viewer overlay only
src/models/
  baseline.py             # train + evaluate 7 models in parallel (~13 s)
  tune.py                 # Optuna tuning: LightGBM, XGBoost, RF, GB (100 trials, 5-fold parallel CV)
  export_onnx.py          # export best model → ONNX for JS/browser inference
js/lib/
  src/parser.js           # beatmap .dat parser (v2/v3/v4) + findDatInfo() for NJS/offset
  src/patterns.js         # canonical pattern annotator (single source of truth)
  src/features.js         # full feature vector: stats + patterns + NJS/NPS/SPS (bsmap)
  scripts/annotate_batch.js      # batch: named pattern counts + NJS/NPS/SPS per map
  scripts/compute_features_batch.js  # batch: full feature vector (training/inference parity check)
data/raw/maps/            # downloaded + extracted map zips (gitignored)
data/processed/
  pattern_features.csv           # statistical features from map_parser.py
  pattern_features_merged.csv    # training input: stats + JS patterns + NJS/NPS/SPS (225 cols)
  js_features.csv                # feature vector from compute_features_batch.js (used by export)
  feature_stats_by_category.json
models/
  baseline_models/        # .pkl + _metrics.json per model
  tuned/                  # Optuna result JSON + .pkl per model
  onnx/                   # pattern_classifier.onnx + _meta.json
docs/patterns/            # 45 named pattern folders with wiki reference images
wiki/                     # BSMG wiki git submodule (map format docs)
```

### Notes

- NaN values in JS-computed features for maps with no notes in a given window are imputed with column median in both `baseline.py` and `tune.py`.
- `pattern_features_merged.csv` is the canonical training input — regenerate it with `pattern_features_js.py` after downloading/re-downloading maps.
- The JS annotator is the single source of truth for pattern detection; `pattern_annotator.py` is used only for the HTML viewer overlay.
- Geometry columns from `annotate_batch.js` (`njs`, `nps_*`, `sps_*`, etc.) keep their canonical names (no `js_` prefix) so training and inference use identical feature names.
