'use strict';
/**
 * classify.js — ONNX inference pipeline for the Beat Saber map classifier.
 *
 * Works in Node.js and browser. No top-level Node.js imports — all I/O is
 * done via dynamic imports inside loader functions so the module can be
 * bundled for browser use without modification.
 *
 * Node.js:
 *   const clf = await loadClassifier('./models/pattern_classifier.onnx',
 *                                    './models/pattern_classifier_meta.json');
 *
 * Browser (or any fetch-capable environment):
 *   const clf = await loadClassifierFromFetch(
 *     '/models/pattern_classifier.onnx',
 *     '/models/pattern_classifier_meta.json',
 *   );
 *
 * Browser (pre-loaded buffers, e.g. from a bundler or service worker):
 *   const clf = await loadClassifierFromBuffers(modelArrayBuffer, metaObject);
 *
 *   const result = await classifyFromNotes(notes, obstacles, arcs, chains, bpm, [], clf);
 *   // { category: 'Tech', confidence: 0.82, probabilities: { Accuracy: 0.03, ... } }
 */

import { computeFeatures, toFeatureVector } from './features.js';

// ── ORT instance injection (allows bypassing dynamic import in bundled contexts) ─

let _injectedOrt = null;

/** Inject an already-loaded ORT runtime (e.g. `window.ort` from ort.min.js). */
export function setOrtInstance(ort) { _injectedOrt = ort; }

/** Set WASM file paths on the ORT runtime before any session is created. */
export async function setWasmPaths(wasmDir) {
  const ort = _injectedOrt ?? await _loadOrt();
  ort.env.wasm.wasmPaths = wasmDir;
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

/**
 * Apply median imputation + StandardScaler in-place.
 * Mirrors the sklearn pipeline used during training.
 *
 * @param {Float32Array} vec   - raw feature vector (modified in-place)
 * @param {object}       meta  - parsed _meta.json
 * @returns {Float32Array}
 */
function preprocess(vec, meta) {
  const { imputer_medians, scaler_mean, scaler_scale } = meta;
  for (let i = 0; i < vec.length; i++) {
    // Impute NaN / Infinity with training-set median
    if (!isFinite(vec[i])) vec[i] = imputer_medians[i];
    // StandardScaler: z = (x - mean) / scale
    vec[i] = (vec[i] - scaler_mean[i]) / scaler_scale[i];
  }
  return vec;
}

// ── Runtime detection ─────────────────────────────────────────────────────────

async function _loadOrt() {
  if (_injectedOrt) return _injectedOrt;
  // Try Node.js runtime first, then browser runtime
  try { return await import('onnxruntime-node'); } catch {}
  try { return await import('onnxruntime-web');  } catch {}
  throw new Error(
    'No ONNX runtime found. Install onnxruntime-node (Node.js) ' +
    'or onnxruntime-web (browser).'
  );
}

// ── Model loading ─────────────────────────────────────────────────────────────

/**
 * Load from file paths — Node.js only (uses dynamic fs import).
 * Call once and cache the returned object.
 *
 * @param {string} modelPath  - filesystem path to .onnx file
 * @param {string} metaPath   - filesystem path to _meta.json
 * @returns {{ session, meta, ort }}
 */
async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import('node:fs/promises');
  const ort = await _loadOrt();

  const [modelBuf, metaText] = await Promise.all([
    readFile(modelPath),
    readFile(metaPath, 'utf8'),
  ]);

  const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
  const meta    = JSON.parse(metaText);
  return { session, meta, ort };
}

/**
 * Load from URLs using fetch — works in browsers, Deno, and Node.js ≥ 18.
 *
 * @param {string|URL} modelUrl  - URL to .onnx file
 * @param {string|URL} metaUrl   - URL to _meta.json
 * @returns {{ session, meta, ort }}
 */
async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const ort = await _loadOrt();

  const [modelResp, metaResp] = await Promise.all([
    fetch(modelUrl),
    fetch(metaUrl),
  ]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok)  throw new Error(`Failed to fetch meta: ${metaResp.status}`);

  const [modelBuf, meta] = await Promise.all([
    modelResp.arrayBuffer(),
    metaResp.json(),
  ]);

  const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}

/**
 * Load from pre-fetched buffers — works anywhere (browser, worker, bundled apps).
 *
 * @param {ArrayBuffer} modelBuffer - .onnx file contents
 * @param {object}      meta        - parsed _meta.json object
 * @returns {{ session, meta, ort }}
 */
async function loadClassifierFromBuffers(modelBuffer, meta) {
  const ort = await _loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Run the full pipeline: parsed beatmap data → class prediction.
 *
 * @param {Note[]}     notes
 * @param {Obstacle[]} obstacles
 * @param {object[]}   arcs
 * @param {object[]}   chains
 * @param {number}     bpm
 * @param {Note[]}     bombs     (optional)
 * @param {{ session, meta, ort }} classifier  - from loadClassifier()
 * @returns {{ category: string, confidence: number, probabilities: Object }}
 */
async function classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs = [], classifier) {
  const { session, meta, ort } = classifier;

  // 1. Extract features
  const featureMap = computeFeatures(notes, obstacles, arcs, chains, bpm, bombs);

  // 2. Build ordered feature vector
  const rawVec = toFeatureVector(featureMap, meta.features);

  // 3. Preprocess (impute + scale)
  preprocess(rawVec, meta);

  // 4. Run ONNX inference
  const inputName = session.inputNames[0];
  const tensor    = new ort.Tensor('float32', rawVec, [1, meta.n_features]);
  const outputs   = await session.run({ [inputName]: tensor });

  // 5. Parse outputs
  // skl2onnx GradientBoosting: output[0] = label (int64), output[1] = probabilities (float32)
  const labelArr = outputs[session.outputNames[0]].data;   // Int64Array or Int32Array
  const probArr  = outputs[session.outputNames[1]].data;   // Float32Array [1 × n_classes]

  const classIdx = Number(labelArr[0]);
  const category = meta.classes[classIdx];

  // Build probabilities map
  const probabilities = {};
  for (let i = 0; i < meta.classes.length; i++) {
    probabilities[meta.classes[i]] = Number(probArr[i].toFixed(4));
  }

  const confidence = probabilities[category];

  return { category, confidence, probabilities };
}

export { loadClassifier, loadClassifierFromFetch, loadClassifierFromBuffers, classifyFromNotes, preprocess };
