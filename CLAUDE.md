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
# 1. Extract metadata features from the CSV
python src/data/features_v2.py --csv dataset_wc_pooling.csv --output data/processed/features.csv --analyze

# Quick test run (first 100 rows only)
python src/data/features_v2.py --csv dataset_wc_pooling.csv --output data/processed/features.csv --test

# 2. Download actual map zips from BeatSaver (required for pattern features)
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --limit 50
python src/data/downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --category Speed

# 3. Parse downloaded maps and extract statistical features (eBPM, rotation, histograms, etc.)
python src/data/map_parser.py --maps data/raw/maps --output data/processed/pattern_features.csv

# 4. Run JS annotator to extract named pattern counts (n_doubles, n_hooks, etc.)
#    Requires Node.js ≥18. Merges JS counts with map_parser.py statistical features.
python src/data/pattern_features_js.py \
    --maps data/raw/maps \
    --base-features data/processed/pattern_features.csv \
    --output data/processed/pattern_features_merged.csv

# 5. Train all baseline models
python src/models/baseline.py --features data/processed/pattern_features_merged.csv --output models/baseline_models --cross_validate
```

No test suite exists yet (`tests/` is empty). `notebooks/` is empty and reserved for Jupyter exploration.

## Architecture

### Full Pipeline

```
dataset_wc_pooling.csv (529 maps, with header row)
    │
    ├─► src/data/features_v2.py ──► data/processed/features.csv
    │   (metadata features: NPS, SPS, NJS, parity, etc.)
    │
    └─► src/data/downloader.py ──► data/raw/maps/<category>/<key>/
        (downloads .zip from BeatSaver, extracts all difficulties,
         saves _dataset.json with characteristic/difficulty/bpm)
            │
            ├─► src/data/map_parser.py ──► data/processed/pattern_features.csv
            │   (statistical features only: eBPM, rotation, lane/layer histograms,
            │    timing CV, windowed features, obstacle/arc density)
            │
            ├─► js/lib/scripts/annotate_batch.js  (Node.js)
            │   (canonical JS pattern annotator → per-map named pattern counts:
            │    n_double, n_hook, n_inline, n_vision_block, etc.)
            │
            └─► src/data/pattern_features_js.py
                (calls annotate_batch.js, merges JS counts + map_parser stats)
                    │
                    └─► data/processed/pattern_features_merged.csv
                            │
                            └─► src/models/baseline.py ──► models/baseline_models/*.pkl
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

### Named Pattern Counts (`js/lib/scripts/annotate_batch.js` + `src/data/pattern_features_js.py`)

The **JS annotator** (`js/lib/src/patterns.js`) is the single source of truth for named pattern detection. `annotate_batch.js` runs it over all downloaded maps and outputs per-map counts. `pattern_features_js.py` calls it via subprocess and merges the counts (prefixed `js_`) into the statistical features CSV.

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

Trains 7 algorithms (LogisticRegression, RandomForest, XGBoost, LightGBM, DecisionTree, SVM, KNN) on the metadata features CSV. Drops non-numeric and ID columns; applies `StandardScaler` + `LabelEncoder`. Explicitly drops any remaining `Balanced` rows as a safety net.

**Current best** (metadata features only): XGBoost — 66.98% accuracy, 66.59% F1 (5-fold CV: 64.26% ± 0.95%). Pattern features from `map_parser.py` are expected to close the gap toward the 80%+ target.

### Directory Layout

```
src/data/
  features_v2.py          # metadata feature extraction (canonical)
  downloader.py           # BeatSaver map downloader
  map_parser.py           # .dat file parser → statistical features only (eBPM, rotation, etc.)
  pattern_features_js.py  # calls JS annotator, merges pattern counts into training CSV
src/models/
  baseline.py             # model training and evaluation
js/lib/
  src/parser.js           # beatmap .dat parser (v2/v3/v4)
  src/patterns.js         # canonical pattern annotator (single source of truth)
  src/features.js         # statistical feature extraction (mirrors map_parser.py)
  scripts/annotate_batch.js  # batch runner: walks maps dir, outputs per-map pattern counts
data/raw/maps/            # downloaded + extracted map zips (gitignored)
data/processed/
  features.csv                   # metadata features (529→503 maps after Balanced exclusion)
  pattern_features.csv           # statistical features from map_parser.py
  pattern_features_merged.csv    # merged: statistical + JS pattern counts (training input)
  category_distribution.csv
  feature_stats_by_category.json
docs/patterns/       # 45 named pattern folders, each with wiki reference image(s)
models/baseline_models/  # .pkl models + _metrics.json + _cv_results.json
wiki/                # BSMG wiki git submodule (mapping docs, glossary, map format spec)
```

### Known Data Issues

- NaN values in some `bsmap` JSON-derived features (missing keys) → SVM and KNN fail; Phase 2 task to impute
- `pattern_features_merged.csv` only exists once maps are downloaded, parsed, and JS-annotated — baseline training currently uses `features.csv` only
- The JS annotator is the single source of truth for pattern detection; `pattern_annotator.py` is used only for the HTML viewer overlay
