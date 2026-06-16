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

# 3. Parse downloaded maps and extract pattern features
python src/data/map_parser.py --maps data/raw/maps --output data/processed/pattern_features.csv

# 4. Train all baseline models (on metadata features for now)
python src/models/baseline.py --features data/processed/features.csv --output models/baseline_models --cross_validate
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
            └─► src/data/map_parser.py ──► data/processed/pattern_features.csv
                (parses the correct .dat file, extracts note-level patterns)
                    │
                    └─► src/models/baseline.py ──► models/baseline_models/*.pkl
                        (can train on metadata features, pattern features, or merged)
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

### Pattern Feature Extraction (`src/data/map_parser.py`)

The core of the project. Parses the actual `.dat` beatmap file for the labelled difficulty and extracts note-level features that reflect how the map actually plays.

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

**Named pattern counts** (from `count_patterns()` — see `docs/patterns/<name>/` for wiki reference images):

| Pattern | Count feature | Detectable? | Category signal |
|---|---|---|---|
| Stream | `n_stream_runs`, `n_stream_notes`, `longest_stream` | MED | High → Speed |
| Vibro stream | `n_vibro_notes` | MED | High → Speed/Extreme |
| Double | `n_doubles` | HIGH | High → Standard/Extreme |
| Scissor | `n_scissor` | HIGH | Present → Tech/Accuracy |
| Stack | `n_stacks` | HIGH | High → Standard/Extreme |
| Tower | `n_towers` | HIGH | High → Extreme |
| Crossover | `n_crossovers` | HIGH | High → Tech |
| Crossover Scissor | `n_crossover_scissor` | HIGH | High → Tech |
| DD (parity break) | `n_dd` | HIGH | High → Tech |
| Triangle | `n_triangles` | MED | Present → Tech |
| Inline | `n_inline` | HIGH | High → Tech |
| Jump | `n_jumps` | MED | High → Speed/Extreme |
| Invert | `n_inverts` | HIGH | High → Accuracy/Tech |
| Flick | `n_flicks` | MED | High → Speed |
| Gallop | `n_gallops` | MED | Present → Standard/Extreme |
| Quad | `n_quads` | HIGH | Rare → Extreme |
| Paul | `n_paul` | HIGH | Rare → Tech |
| Face note | `n_face_notes` | HIGH | High → Tech/Extreme |
| Dot note | `n_dot_notes` | HIGH | High → Speed/Standard |
| Top-row note | `n_top_row_notes` | HIGH | High → Tech/Extreme |

All `n_*` counts also have a corresponding `n_*_rate` (normalised by total note count).

**eBPM formula**: `ebpm = bpm * 0.5 / per_hand_interval_beats` — at 1/4 stream (interval=0.5 beats) eBPM equals song BPM, matching the BSMG wiki definition.

### Model Training (`src/models/baseline.py`)

Trains 7 algorithms (LogisticRegression, RandomForest, XGBoost, LightGBM, DecisionTree, SVM, KNN) on the metadata features CSV. Drops non-numeric and ID columns; applies `StandardScaler` + `LabelEncoder`. Explicitly drops any remaining `Balanced` rows as a safety net.

**Current best** (metadata features only): XGBoost — 66.98% accuracy, 66.59% F1 (5-fold CV: 64.26% ± 0.95%). Pattern features from `map_parser.py` are expected to close the gap toward the 80%+ target.

### Directory Layout

```
src/data/
  features_v2.py     # metadata feature extraction (canonical, replaces features.py)
  downloader.py      # BeatSaver map downloader
  map_parser.py      # .dat file parser → pattern features
src/models/
  baseline.py        # model training and evaluation
data/raw/maps/       # downloaded + extracted map zips (gitignored)
data/processed/
  features.csv       # metadata features (529→503 maps after Balanced exclusion)
  pattern_features.csv  # note-level pattern features (after downloading)
  category_distribution.csv
  feature_stats_by_category.json
docs/patterns/       # 45 named pattern folders, each with wiki reference image(s)
models/baseline_models/  # .pkl models + _metrics.json + _cv_results.json
wiki/                # BSMG wiki git submodule (mapping docs, glossary, map format spec)
```

### Known Data Issues

- NaN values in some `bsmap` JSON-derived features (missing keys) → SVM and KNN fail; Phase 2 task to impute
- `pattern_features.csv` only exists once maps are downloaded and parsed — baseline training currently uses `features.csv` only
