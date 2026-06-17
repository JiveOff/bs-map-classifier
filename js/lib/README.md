# bs-map-classifier

Classify Beat Saber custom maps into **Tech · Speed · Accuracy · Standard · Extreme** using an ONNX gradient-boosting model trained on 200+ note-level pattern features.

Works in **Node.js** (file-based loading) and **browser** (fetch-based loading, via `onnxruntime-web`).

## Install

```bash
npm install bs-map-classifier

# One ONNX runtime is required — pick the one that matches your environment:
npm install onnxruntime-node   # Node.js
npm install onnxruntime-web    # browser / bundler
```

## Quick start — from BeatSaver

```js
import { loadFromKey } from 'bs-map-classifier/beatsaver';
import { loadEmbeddedClassifier, extractPatternsAndClassifyMap } from 'bs-map-classifier/embedded';

const clf = await loadEmbeddedClassifier();
const { beatmap, bpm, songName } = await loadFromKey('2b120'); // BeatSaver map key

const { classification } = await extractPatternsAndClassifyMap(beatmap, bpm, clf);
console.log(`${songName} → ${classification.category} (${(classification.confidence * 100).toFixed(1)}%)`);
```

`loadFromKey(key, characteristic?, difficulty?)` fetches metadata + zip from BeatSaver, extracts the correct `.dat`, and returns a ready-to-classify `beatmap`. Use `loadFromHash(hash)` if you have the zip hash instead.

> See [`examples/`](examples/) for runnable Node.js, browser (Vite), Vue, Bun, and WASM examples.

## Quick start — embedded model

The `/embedded` subpath bundles the ONNX model at build time — no file paths, no network requests:

```js
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import { parseBeatmap, findDatFilename, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { readFile } from 'node:fs/promises';

// Model is already baked into the package — call once and cache
const clf = await loadEmbeddedClassifier();

// Parse a beatmap .dat file
const infoDat = JSON.parse(await readFile('Info.dat', 'utf8'));
const datFile = findDatFilename(infoDat, 'Standard', 'ExpertPlus');
const datJson = JSON.parse(await readFile(datFile, 'utf8'));

// Features + pattern annotation + classification in one call
const result = await extractPatternsAndClassifyMap(parseBeatmap(datJson), /* bpm */ 180, clf);

console.log(result.classification.category);    // e.g. "Tech"
console.log(result.classification.confidence);  // e.g. 0.87
console.log(result.classification.probabilities);
// { Accuracy: 0.02, Extreme: 0.04, Speed: 0.05, Standard: 0.02, Tech: 0.87 }

console.log(`${result.patterns.length} pattern events detected`);
// result.patterns: [{ type, label, beat, time, notes }, ...]
// result.features: { lane_0_rate, ebpm_left_mean, n_crossovers, ... }
```

## CommonJS

```js
const { loadEmbeddedClassifier } = require('bs-map-classifier/embedded');
const { parseBeatmap }            = require('bs-map-classifier');
```

## Custom model path (advanced)

```js
import { loadClassifier, parseBeatmap, extractPatternsAndClassifyMap } from 'bs-map-classifier';

const clf = await loadClassifier(
  '/path/to/pattern_classifier.onnx',
  '/path/to/pattern_classifier_meta.json',
);
```

## Browser (fetch-based)

```js
import {
  loadClassifierFromFetch, parseBeatmap, findDatFilename,
  extractPatternsAndClassifyMap, setOrtInstance, setWasmPaths,
} from 'bs-map-classifier';
import * as ort from 'onnxruntime-web/wasm';

// Configure ORT before creating any session
ort.env.wasm.numThreads = 1;
setOrtInstance(ort);
setWasmPaths('/wasm/');  // directory containing ort-wasm-simd-threaded.wasm

const clf    = await loadClassifierFromFetch(
  '/models/pattern_classifier.onnx',
  '/models/pattern_classifier_meta.json',
);
const result = await extractPatternsAndClassifyMap(parseBeatmap(datJson), bpm, clf);
```

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

### High-level convenience

| Function | Returns | Use when… |
|---|---|---|
| `extractPatterns(beatmap, bpm, meta?)` | `PatternResult` | You only need features and pattern events |
| `classifyMap(beatmap, bpm, classifier)` | `Promise<ClassifyResult>` | You only need the category prediction |
| `extractPatternsAndClassifyMap(beatmap, bpm, classifier, meta?)` | `Promise<MapAnalysisResult>` | You need everything |

```ts
// PatternResult
{
  features:      Record<string, number>,  // 202 statistical features
  patterns:      PatternEvent[],          // annotated pattern timeline
  patternColors: Record<string, string>,  // hex colours per pattern type
  allNotes:      Note[],
}

// MapAnalysisResult extends PatternResult
{
  ...PatternResult,
  classification: { category, confidence, probabilities },
}
```

### Low-level

```ts
classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, classifier)
  → Promise<ClassifyResult>

computeFeatures(notes, obstacles, arcs, chains, bpm, bombs)
  → Record<string, number>

annotatePatterns(notes, bpm, meta?)
  → { patterns, colors, all_notes, meta }
```

### Browser helpers

```ts
setOrtInstance(ort)       // inject pre-loaded ORT runtime
setWasmPaths(wasmDirUrl)  // set WASM directory before first session
```

## Categories

| Category | Typical characteristics |
|---|---|
| **Tech** | Crossovers, doubles, triangles, high parity-break rate |
| **Speed** | Dense streams, high eBPM, dot-heavy |
| **Accuracy** | Arc-heavy, low parity breaks, structured patterns |
| **Standard** | Balanced mix, moderate density |
| **Extreme** | Very high density, towers, quads, walls |

## Pattern types

`extractPatterns` and `extractPatternsAndClassifyMap` return events of these types: `double`, `scissor`, `crossover`, `crossover_scissor`, `stack`, `tower`, `stream`, `dd` (double-directional), `jump`, `invert`.

## License

MIT
