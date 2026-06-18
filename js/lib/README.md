# bs-map-classifier

Classify Beat Saber custom maps into **Tech · Speed · Accuracy · Standard · Extreme** using an ONNX model trained on 125 note-level features (pattern statistics, NJS, NPS, SPS). Runs entirely in **Node.js** and **browser** with no BeatSaver API calls required (except from initial download if not using a local map).

**88.89% accuracy / 85.13% CV F1** on the BSWC pooling dataset (LightGBM + Optuna-tuned, exported via onnxmltools).

## Install

```bash
npm install bs-map-classifier

# One ONNX runtime is required — pick the one that matches your environment:
npm install onnxruntime-web    # browser / bundler / Node.js (WASM, recommended)
npm install onnxruntime-node   # Node.js only (native addon, faster but less portable)
```

> `onnxruntime-web` (WASM) works in both Node.js and browsers. `onnxruntime-node` uses a native `.node` addon that may fail in sandboxed runtimes or some CI setups — prefer `onnxruntime-web` unless you have a specific reason to use the native runtime.

## Performance

Measured on Apple M4, Node.js 20, `onnxruntime-web`:

| Metric | Result | Map |
|--------|--------|-----|
| `loadEmbeddedClassifier` (init) | ~135 ms | — |
| `classifyMap` median | ~0.06 ms | empty beatmap |
| `classifyMap` median | ~6.2 ms | Flashes — 2088 notes |
| `classifyMap` p95 | ~10.5 ms | Flashes — 2088 notes |

Init is a one-time cost — load the classifier once at startup and reuse it for every map. Per-map inference scales with note count.

Historical results tracked per commit on the [`gh-benchmarks` branch](https://github.com/JiveOff/bs-map-classifier/tree/gh-benchmarks) — runs on GitHub Actions (`ubuntu-latest`). Absolute numbers are not meaningful on shared CI runners; use them to spot regressions, not as performance targets.

## Quick start — from BeatSaver

```js
import { loadFromKey } from 'bs-map-classifier/beatsaver';
import { loadEmbeddedClassifier, classifyMap } from 'bs-map-classifier/embedded';

const clf = await loadEmbeddedClassifier();
const { beatmap, bpm, songName } = await loadFromKey('2b120');
const classification = await classifyMap(beatmap, bpm, clf);
console.log(`${songName} → ${classification.category} (${(classification.confidence * 100).toFixed(1)}%)`);
// "Flashes → Speed (100.0%)"
```

> See [`examples/`](https://github.com/JiveOff/bs-map-classifier/tree/main/js/lib/examples) for runnable Node.js, browser (Vite), Vue, Bun, and WASM examples.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/JiveOff/bs-map-classifier/tree/main/js/lib/examples/node-wasm)

## Quick start — from local files

If you already have the map files locally, skip the BeatSaver helper and parse them directly:

```js
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import { parseBeatmap, findDatFilename, classifyMap } from 'bs-map-classifier';
import { readFile } from 'node:fs/promises';

const clf = await loadEmbeddedClassifier(); // ~200ms to initialise — reuse clf for every map

const infoDat = JSON.parse(await readFile('Info.dat', 'utf8'));
const datFile = findDatFilename(infoDat, 'Standard', 'ExpertPlus');
const datJson = JSON.parse(await readFile(datFile, 'utf8'));

const result = await classifyMap(parseBeatmap(datJson), /* bpm */ 180, clf);
console.log(result.category);       // e.g. "Tech"
console.log(result.confidence);     // e.g. 0.87
console.log(result.probabilities);  // { Accuracy: 0.02, Extreme: 0.04, Speed: 0.05, Standard: 0.02, Tech: 0.87 }
```

If you also need the per-note pattern timeline and feature vector, use `extractPatternsAndClassifyMap` instead:

```js
import { extractPatternsAndClassifyMap } from 'bs-map-classifier';

const result = await extractPatternsAndClassifyMap(parseBeatmap(datJson), bpm, clf);
console.log(result.classification.category);
console.log(`${result.patterns.length} pattern events detected`);
// result.patterns: [{ type, label, beat, time, notes }, ...]
// result.features: { lane_0_rate, ebpm_left_mean, js_n_crossover_rate, ... }
```

> **Note:** The individual pattern detector (the per-note timeline events) is **work-in-progress and not yet accurate**. The map-level category classification is separate and not affected.

## CommonJS

```js
const { loadEmbeddedClassifier } = require('bs-map-classifier/embedded');
const { parseBeatmap, classifyMap } = require('bs-map-classifier');
```

## Browser (fetch-based)

```js
import {
  loadClassifierFromFetch, parseBeatmap, findDatFilename,
  classifyMap, setOrtInstance, setWasmPaths,
} from 'bs-map-classifier';
import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.numThreads = 1;
setOrtInstance(ort);
setWasmPaths('/wasm/'); // directory containing ort-wasm-simd-threaded.wasm

const clf    = await loadClassifierFromFetch('/models/pattern_classifier.onnx', '/models/pattern_classifier_meta.json');
const result = await classifyMap(parseBeatmap(datJson), bpm, clf);
```

## Custom model path

```js
import { loadClassifier, parseBeatmap, classifyMap } from 'bs-map-classifier';

const clf = await loadClassifier('/path/to/pattern_classifier.onnx', '/path/to/pattern_classifier_meta.json');
```

---

## API

### BeatSaver helpers (`bs-map-classifier/beatsaver`)

| Function | Description |
|---|---|
| `loadFromKey(key, characteristic?, difficulty?)` | Fetch + parse a map by BeatSaver short key |
| `loadFromHash(hash, characteristic?, difficulty?)` | Fetch + parse a map by zip hash |

Both return `{ beatmap, bpm, njs, njsOffset, characteristic, difficulty, songName, songAuthor, mapAuthor }`.

### Loading

| Function | Environment | Description |
|---|---|---|
| `loadClassifier(modelPath, metaPath)` | Node.js | Load from filesystem paths |
| `loadClassifierFromFetch(modelUrl, metaUrl)` | Browser / Deno / Node ≥18 | Load via `fetch()` |
| `loadClassifierFromBuffers(modelBuffer, meta)` | Anywhere | Load from pre-fetched `ArrayBuffer` + parsed JSON |

### Parsing

| Function | Description |
|---|---|
| `parseBeatmap(datJson)` | Parse a `.dat` file (v2, v3, v4 format auto-detected) → `ParsedBeatmap` |
| `findDatFilename(infoDat, characteristic, difficulty)` | Look up the correct `.dat` filename from `Info.dat` |

### Classification

| Function | Returns | Use when… |
|---|---|---|
| `classifyMap(beatmap, bpm, classifier)` | `Promise<ClassifyResult>` | You only need the category prediction |
| `extractPatterns(beatmap, bpm, meta?)` | `PatternResult` | You only need features and pattern events |
| `extractPatternsAndClassifyMap(beatmap, bpm, classifier, meta?)` | `Promise<MapAnalysisResult>` | You need everything |

```ts
// ClassifyResult
{ category: string, confidence: number, probabilities: Record<string, number> }

// PatternResult
{
  features:      Record<string, number>, // 125 statistical + pattern features
  patterns:      PatternEvent[],         // annotated pattern timeline (WIP)
  patternColors: Record<string, string>, // hex colour per pattern type
  allNotes:      Note[],
}

// MapAnalysisResult extends PatternResult
{ ...PatternResult, classification: ClassifyResult }
```

### Low-level

```ts
classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, classifier) → Promise<ClassifyResult>
computeFeatures(notes, obstacles, arcs, chains, bpm, bombs)               → Record<string, number>
annotatePatterns(notes, bpm, meta?)                                        → { patterns, colors, all_notes, meta }
```

### Browser helpers

```ts
setOrtInstance(ort)       // inject pre-loaded ORT runtime
setWasmPaths(wasmDirUrl)  // set WASM directory before first session
```

---

## Categories

Derived from empirical analysis of the training data — see [`docs/EDA_CONCLUSIONS.md`](https://github.com/JiveOff/bs-map-classifier/blob/main/docs/EDA_CONCLUSIONS.md) for the full breakdown.

| Category | Typical characteristics |
|----------|------------------------|
| **Tech** | High crossover rate (~36% of beats), lateral cuts, frequent parity breaks (DD ~9%), high wall density. Pace is moderate — Tech is spatial complexity, not speed. |
| **Speed** | Highest eBPM, NPS, SPS, and NJS. Linear up/down/diagonal flow, almost no crossovers. High rhythmic variability from alternating dense streams and wide jumps. |
| **Accuracy** | Lowest eBPM, NPS, NJS, and note count. Near-zero parity breaks (DD ~0.8%), clean alternating swings, no lateral cuts. |
| **Standard** | Moderate on every metric — defined by not being distinctive on any single axis. |
| **Extreme** | Tech-level crossovers and walls combined with Speed-level eBPM and NJS. Highest DD rate and invert count of all categories. |

## Pattern types

`extractPatterns` and `extractPatternsAndClassifyMap` return a timeline of pattern events. Each event has `{ type, label, beat, time, notes }`.

Current types: `stream`, `vibro_stream`, `jump_stream`, `piano_stream`, `double`, `scissor`, `crossover_scissor`, `stack`, `tower`, `quad`, `crossover`, `dd`, `triangle`, `inline`, `jump`, `invert`, `flick`, `gallop`, `hook`, `window`, `handclap`, `vision_block`, `face_note`, `dot_note`, `top_row_note`, `loloppe`, `scoop`, `shrado`, `arm_circle`, `staircase`, `croissant`, `paul`, `dot_spam`, `flower`, `groove_wall`, `bomb_reset`, `bomb_hold`, `hammer_hit`.

See [`docs/PATTERNS.md`](https://github.com/JiveOff/bs-map-classifier/blob/main/docs/PATTERNS.md) for descriptions and reference images, and [`docs/FEATURES.md`](https://github.com/JiveOff/bs-map-classifier/blob/main/docs/FEATURES.md) for the full feature reference.

## Dataset & limitations

The model is trained exclusively on maps from the **BSWC (Beat Saber World Cup) pooling database** — ~500 curated competitive maps. Two things to keep in mind:

- **Subjectivity**: labels reflect the poolers' judgement. The model inherits that subjectivity.
- **Coverage**: unusual or niche mapping styles not represented in competitive pools may be misclassified.

Suggestions for new maps can be submitted at [cube.community/pooling/suggestion](https://cube.community/pooling/suggestion).

## License

MIT
