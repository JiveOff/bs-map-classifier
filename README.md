# Beat Saber Map Classifier

ML classifier for Beat Saber custom maps into 5 categories: **Tech**, **Speed**, **Accuracy**, **Standard**, **Extreme**.

The primary signal comes from note-level pattern features extracted directly from `.dat` map files — what a player actually has to hit, not summary metadata. The ONNX classifier reaches **88.89% accuracy / 85.13% CV F1** (125 features including NJS, NPS, SPS via bsmap, LightGBM + Optuna-tuned, exported via onnxmltools). It runs entirely in browser and Node.js with no BeatSaver metadata API required.

## Categories

| Category | Characteristics |
|----------|----------------|
| **Tech** | Complex patterns, crossovers, high wall count, parity resets |
| **Speed** | High NPS/eBPM, linear swings, fast streams |
| **Accuracy** | Precision-focused, high rbRatio, arc-heavy |
| **Standard** | Balanced, conventional mapping |
| **Extreme** | Highest difficulty across all metrics — high NPS + complexity |

## Dataset & limitations

The model is trained exclusively on maps from the **BSWC (Beat Saber World Cup) pooling database** — a curated set of competitive maps maintained by the BSWC map poolers. This has two implications:

- **Subjectivity**: the category labels reflect the poolers' judgement. Reasonable people can disagree on where a map falls, and the model inherits that subjectivity.
- **Coverage**: the model has only seen ~500 maps out of hundreds of thousands on BeatSaver. Unusual or niche mapping styles that aren't represented in competitive pools may be misclassified.

The pooling database is closed but publicly accessible. Map poolers actively maintain it, and **[suggestions for new maps can be submitted](https://cube.community/pooling/suggestion)** — accepted maps may be included in the dataset for future training runs.

## Using the classifier

```bash
npm install bs-map-classifier onnxruntime-web
```

> **Note:** `onnxruntime-web` (WASM) works in Node.js and browsers alike. `onnxruntime-node` uses a native `.node` addon and will fail in environments where native addons are disabled (sandboxed runtimes, some CI setups, Deno, etc.) — prefer `onnxruntime-web` unless you have a specific reason to use the native runtime.

```js
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import { parseBeatmap, findDatFilename, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { readFile } from 'node:fs/promises';

const clf     = await loadEmbeddedClassifier();
const infoDat = JSON.parse(await readFile('Info.dat', 'utf8'));
const datJson = JSON.parse(await readFile(findDatFilename(infoDat, 'Standard', 'ExpertPlus'), 'utf8'));
const result  = await extractPatternsAndClassifyMap(parseBeatmap(datJson), /* bpm */ 180, clf);

console.log(result.classification.category);    // 'Tech'
console.log(result.classification.confidence);  // 0.87
console.log(result.patterns.length + ' patterns detected');
```

Try it instantly in your browser: **[Open in StackBlitz](https://stackblitz.com/edit/node-kehuegda?file=index.js)** · **[Web demo](https://jiveoff.github.io/bs-map-classifier/)**

See [`js/lib/README.md`](js/lib/README.md) for the full API — browser usage, custom model paths, `annotatePatterns`, TypeScript types, CJS usage, and a complete BeatSaver fetch example.

### Explore the outputs

| Resource | Description |
|---|---|
| [`models/onnx/`](https://github.com/JiveOff/bs-map-classifier/tree/main/models/onnx) | Trained ONNX models + meta JSON (pattern-only, gradient boosting, random forest) |
| [`data/processed/feature_stats_by_category.json`](https://github.com/JiveOff/bs-map-classifier/blob/main/data/processed/feature_stats_by_category.json) | Per-category feature statistics (mean, std, min, max) |
| [`docs/RESULTS.md`](https://github.com/JiveOff/bs-map-classifier/blob/main/docs/RESULTS.md) | Full model results with per-class breakdowns |
| [`docs/PATTERNS.md`](https://github.com/JiveOff/bs-map-classifier/blob/main/docs/PATTERNS.md) | Pattern type reference with images |

---

## Using the overlay

`bs-pattern-overlay` is a browser extension and userscript that runs on top of Beat Saber map viewers. It auto-detects the current map, downloads the zip from BeatSaver, and overlays a scrollable pattern timeline synced to playback — powered by the same classifier.

![Pattern overlay](docs/overlay.png)

### Browser extension

Install from the [latest release](https://github.com/JiveOff/bs-map-classifier/releases/latest) — grab `bs-pattern-overlay-vX.X.X.zip`, unzip it, then load it as an unpacked extension in Chrome (`chrome://extensions` → Load unpacked) or Firefox.

Works on [ArcViewer](https://allpoland.github.io/ArcViewer/), [BeatSaver](https://beatsaver.com) map pages, and ScoreSaber.

### Userscript

Install via [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) — click **[Install userscript](https://github.com/JiveOff/bs-map-classifier/releases/latest/download/bs-pattern-overlay.user.js)**. Same sites as the extension; no browser extension store required.

---

## Python pipeline setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
brew install libomp  # macOS only, required for XGBoost
```

---

## Full Pipeline

### Step 1 — Download map zips

Download the actual `.zip` files from the BeatSaver API and extract them. Each map lands at `data/raw/maps/<category>/<key>/` with two sidecar files: `_beatsaver.json` (full API response) and `_dataset.json` (difficulty/characteristic/BPM needed by the parser).

```bash
python src/data/downloader.py \
  --csv dataset_wc_pooling.csv \
  --output data/raw/maps

# Options:
# --limit 50          download first N maps only
# --category Speed    download a single category
```

Output: `data/raw/maps/<category>/<key>/*.dat` + sidecars

---

### Step 2 — Statistical features

Parse the labelled difficulty's `.dat` file for each map and extract note-level statistical features. Handles beatmap formats v2, v3, and v4.

```bash
python src/data/map_parser.py \
  --maps data/raw/maps \
  --output data/processed/pattern_features.csv
```

Output: `data/processed/pattern_features.csv` (493 maps × 128 features)

**Feature groups:**
- Lane/layer histograms, direction histograms, hand balance
- eBPM per hand (mean/median/max/p90), timing variability, rotation
- Arc and chain rates, wall density
- 72 windowed features: 16-beat window aggregates for note density, crossover rate, eBPM, stream rate, etc.

---

### Step 3 — JS pattern counts + geometry features

Run the Node.js annotator over all downloaded maps. Produces named pattern counts **and** NJS/NPS/SPS geometry features computed via [`bsmap`](https://www.npmjs.com/package/bsmap). Merges with the statistical features from Step 2.

```bash
python src/data/pattern_features_js.py \
  --maps data/raw/maps \
  --base-features data/processed/pattern_features.csv \
  --output data/processed/pattern_features_merged.csv
```

Output: `data/processed/pattern_features_merged.csv` (493 maps × 225 features)

> **Requires Node.js ≥18** and `pnpm install` in `js/lib/`.

**Pattern counts** (prefixed `js_`, 28 types, each with a `_rate` variant):
streams, crossovers, doubles, DDs, scissors, towers, loloppes, hooks, bomb resets, stacks, gallops, flicks, jumps, handclaps, vision blocks, and more.

**Geometry features** (canonical names, no prefix — shared with JS inference):

| Group | Features | Signal |
|---|---|---|
| NJS / jump | `njs`, `njs_offset`, `jump_distance`, `reaction_time`, `hjd` | Lower RT → harder to read |
| JD quality | `jd_optimal_low/high`, `jd_delta_low/high` | JD outside optimal range |
| NPS | `nps_mapped`, `peak_nps_4/8/16beat` | Burst density → Speed/Extreme |
| SPS | `sps_total/red/blue_{avg,median,peak}` | ScoreSaber-canonical swing density |

---

### Step 4 — Baseline training

Train 7 models in parallel (~13 s). Results saved as `.pkl` + `_metrics.json`.

```bash
python src/models/baseline.py \
  --features data/processed/pattern_features_merged.csv \
  --output models/baseline_models \
  --cross_validate
```

Output: `models/baseline_models/<model>.pkl` + `<model>_metrics.json`

| Model | Accuracy | F1 |
|---|---|---|
| XGBoost | 86.87% | 86.62% |
| LightGBM | 85.86% | 85.66% |
| Logistic Regression | 85.86% | 85.63% |
| Gradient Boosting | 85.86% | 85.61% |
| Random Forest | 83.84% | 83.66% |

---

### Step 5 — Hyperparameter tuning

Run Optuna TPE Bayesian optimisation over LightGBM, XGBoost, RandomForest, and GradientBoosting. Objective: 5-fold CV F1 (weighted) with eBPM-split Extreme class weights. CV folds are parallelised.

```bash
python src/models/tune.py \
  --features data/processed/pattern_features_merged.csv \
  --trials 100

# Subset of models only:
python src/models/tune.py --models random_forest gradient_boosting
```

Output: `models/tuned/<model>.pkl` + `<model>_result.json`

**Tuning results (100 trials):**

| Model | Time | CV F1 | Test Acc | Test F1 |
|---|---|---|---|---|
| **LightGBM** | ~70s | 85.13% | **88.89%** | **88.80%** |
| Gradient Boosting | ~17m | 84.93% | 86.87% | 86.95% |
| XGBoost | ~2m | 85.33% | 83.84% | 83.70% |
| Random Forest | ~1.5m | 84.66% | 82.83% | 82.53% |

All 4 models are ONNX-exportable:
- GradientBoosting / RandomForest → `skl2onnx` (native sklearn)
- LightGBM / XGBoost → `onnxmltools` (opset 15)

---

### Step 6 — ONNX export

Export the best model to ONNX for the JS/browser inference pipeline.

```bash
python src/models/export_onnx.py --maps data/raw/maps
```

The export script runs `compute_features_batch.js` to get the exact JS feature vector, trains a fresh GradientBoosting with the best Optuna params + eBPM-split weights, and exports.

Each ONNX file ships with a `*_meta.json` containing:
- `features` — ordered feature name list
- `classes` — class label order
- `imputer_medians` — per-feature median for NaN imputation
- `scaler_mean` / `scaler_scale` — StandardScaler parameters

Output: `models/onnx/pattern_classifier.onnx` + `models/onnx/pattern_classifier_meta.json`

---

## Project Structure

```
src/
  data/
    downloader.py              # Step 1 — BeatSaver map downloader
    map_parser.py              # Step 2 — .dat parser → statistical features
    pattern_features_js.py     # Step 3 — calls JS annotator, merges features
    pattern_annotator.py       # per-note pattern labelling (HTML viewer overlay only)
    features_v2.py             # legacy metadata feature extraction
  models/
    baseline.py                # Step 4 — train + evaluate 7 models in parallel
    tune.py                    # Step 5 — Optuna tuning (LightGBM/XGBoost/RF/GB)
    export_onnx.py             # Step 6 — export to ONNX
js/lib/                        # bs-map-classifier npm package
  src/
    parser.js                  #   beatmap .dat parser (v2/v3/v4) + findDatInfo()
    patterns.js                #   canonical pattern annotator (single source of truth)
    features.js                #   full feature vector (stats + patterns + NJS/NPS/SPS)
    classify.js                #   ONNX inference entry point
  scripts/
    annotate_batch.js          #   batch: pattern counts + NJS/NPS/SPS per map
    compute_features_batch.js  #   batch: full feature vector (parity check)
  models/                      #   pattern_classifier.onnx + _meta.json
  dist/                        #   CJS bundle + embedded.mjs
  types/                       #   TypeScript definitions
data/
  raw/maps/                    # downloaded + extracted map zips (gitignored)
  processed/
    pattern_features.csv       # statistical features from map_parser.py
    pattern_features_merged.csv  # training input (225 cols)
    js_features.csv            # canonical JS feature vector for ONNX export
    feature_stats_by_category.json
models/
  baseline_models/             # _metrics.json per model (+ .pkl, gitignored)
  tuned/                       # Optuna result JSON per model (+ .pkl, gitignored)
  onnx/                        # pattern_classifier.onnx + _meta.json
docs/
  RESULTS.md                   # detailed results and per-class breakdowns
  PATTERNS.md                  # pattern type reference with images
wiki/                          # BSMG wiki submodule (map format docs)
```

## Results summary

Full progression from metadata-only to current best:

| Stage | Features | Best acc | CV F1 |
|-------|----------|----------|-------|
| Metadata only (XGBoost) | 72 | 66.98% | 64.3% |
| + JS pattern pipeline (untuned) | 103 | 82.97% | — |
| + Extreme eBPM-split weighting | 103 | — | 84.03% |
| + Optuna tuning (100 trials) | 103 | — | 84.57% |
| + NJS / NPS / SPS features (bsmap, untuned) | 223 | 86.87% | 84.69% |
| **+ Optuna tuning, LightGBM (100 trials)** | **223** | **88.89%** | **85.13%** |

See [`docs/RESULTS.md`](docs/RESULTS.md) for full per-class breakdowns and finding notes.

## Acknowledgements

- [BSWC Pooling Team](https://cube.community/pooling) — initial dataset of categorised maps used for training
- [BSMG Wiki](https://bsmg.wiki/) — mapping format documentation
- [BeatSaver](https://beatsaver.com/) — map data and API
- [BeatSaber-JSMap](https://github.com/KivalEvan/BeatSaber-JSMap) by Kival Evan - additional features

---

> Most of the code in this repository was AI-generated using [Claude Sonnet 4.6](https://www.anthropic.com/claude).
