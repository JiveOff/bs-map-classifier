'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preprocess } from '../src/infer.js';
import { computeFeatures, toFeatureVector } from '../src/features.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(__dirname, '../../../models/onnx/pattern_classifier.onnx');
const META_PATH  = resolve(__dirname, '../../../models/onnx/pattern_classifier_meta.json');
const MODEL_EXISTS = existsSync(MODEL_PATH) && existsSync(META_PATH);

// ── preprocess ────────────────────────────────────────────────────────────────

test('preprocess: standard-scales values', () => {
  const vec = new Float32Array([2.0, 3.0]);
  const meta = {
    imputer_medians: [0.0, 0.0],
    scaler_mean:     [1.0, 1.0],
    scaler_scale:    [1.0, 2.0],
  };
  preprocess(vec, meta);
  // (2.0 - 1.0) / 1.0 = 1.0
  assert.ok(Math.abs(vec[0] - 1.0) < 1e-6, `expected 1.0, got ${vec[0]}`);
  // (3.0 - 1.0) / 2.0 = 1.0
  assert.ok(Math.abs(vec[1] - 1.0) < 1e-6, `expected 1.0, got ${vec[1]}`);
});

test('preprocess: imputes NaN with median before scaling', () => {
  const vec = new Float32Array([NaN, 4.0]);
  const meta = {
    imputer_medians: [5.0, 0.0],
    scaler_mean:     [0.0, 0.0],
    scaler_scale:    [1.0, 1.0],
  };
  preprocess(vec, meta);
  assert.ok(Math.abs(vec[0] - 5.0) < 1e-6, `expected 5.0, got ${vec[0]}`);
  assert.ok(Math.abs(vec[1] - 4.0) < 1e-6, `expected 4.0, got ${vec[1]}`);
});

test('preprocess: imputes Infinity with median', () => {
  const vec = new Float32Array([Infinity, -Infinity]);
  const meta = {
    imputer_medians: [2.0, 3.0],
    scaler_mean:     [0.0, 0.0],
    scaler_scale:    [1.0, 1.0],
  };
  preprocess(vec, meta);
  assert.ok(Math.abs(vec[0] - 2.0) < 1e-6);
  assert.ok(Math.abs(vec[1] - 3.0) < 1e-6);
});

test('preprocess: zero vector stays zero when mean is zero', () => {
  const vec = new Float32Array([0.0, 0.0, 0.0]);
  const meta = {
    imputer_medians: [0.0, 0.0, 0.0],
    scaler_mean:     [0.0, 0.0, 0.0],
    scaler_scale:    [1.0, 1.0, 1.0],
  };
  preprocess(vec, meta);
  assert.ok(Math.abs(vec[0]) < 1e-9);
  assert.ok(Math.abs(vec[1]) < 1e-9);
  assert.ok(Math.abs(vec[2]) < 1e-9);
});

test('preprocess: modifies vec in-place and returns it', () => {
  const vec = new Float32Array([1.0]);
  const meta = { imputer_medians: [0.0], scaler_mean: [0.0], scaler_scale: [1.0] };
  const result = preprocess(vec, meta);
  assert.ok(result === vec, 'preprocess should return the same Float32Array');
});

test('preprocess: handles multi-feature vectors correctly', () => {
  const values = [1, 2, 3, 4, 5];
  const vec = new Float32Array(values);
  const meta = {
    imputer_medians: new Array(5).fill(0),
    scaler_mean:     values.map(v => v - 1),
    scaler_scale:    new Array(5).fill(2.0),
  };
  preprocess(vec, meta);
  for (let i = 0; i < 5; i++)
    assert.ok(Math.abs(vec[i] - 0.5) < 1e-6, `index ${i}: expected 0.5, got ${vec[i]}`);
});

// ── Feature-meta parity ───────────────────────────────────────────────────────
// Guards against feature drift: features.js changes without re-exporting the model.

test('computeFeatures produces exactly the features listed in pattern_classifier_meta.json', {
  skip: !MODEL_EXISTS ? 'model files not found — run export_onnx.py first' : false,
}, async () => {
  const meta = JSON.parse(await readFile(META_PATH, 'utf8'));
  const notes = [
    { beat: 0.0,  x: 0, y: 0, color: 0, direction: 1 },
    { beat: 0.25, x: 3, y: 0, color: 1, direction: 0 },
    { beat: 0.5,  x: 1, y: 1, color: 0, direction: 3 },
    { beat: 0.75, x: 2, y: 1, color: 1, direction: 2 },
  ];
  const feats = computeFeatures(notes, [], [], [], 120, []);

  // Every feature in meta must exist in computeFeatures output
  const missing = meta.features.filter(f => !(f in feats));
  assert.equal(missing.length, 0,
    `features.js is missing ${missing.length} features expected by the model: ${missing.slice(0,5).join(', ')}`);

  // No extra features should sneak into the vector (dimension must match)
  const vec = toFeatureVector(feats, meta.features);
  assert.equal(vec.length, meta.n_features,
    `vector length ${vec.length} !== meta.n_features ${meta.n_features}`);

  // No NaN or Infinity in the vector
  const badIdx = [...vec].findIndex(v => !isFinite(v));
  assert.equal(badIdx, -1, `feature vector contains non-finite value at index ${badIdx}`);
});

test('meta.json has correct structure and known classes', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const meta = JSON.parse(await readFile(META_PATH, 'utf8'));
  assert.ok(Array.isArray(meta.features),       'meta.features should be an array');
  assert.ok(Array.isArray(meta.classes),         'meta.classes should be an array');
  assert.ok(Array.isArray(meta.imputer_medians), 'meta.imputer_medians should be an array');
  assert.ok(Array.isArray(meta.scaler_mean),     'meta.scaler_mean should be an array');
  assert.ok(Array.isArray(meta.scaler_scale),    'meta.scaler_scale should be an array');
  assert.equal(meta.features.length, meta.n_features);
  assert.equal(meta.imputer_medians.length, meta.n_features);
  assert.equal(meta.scaler_mean.length,     meta.n_features);
  assert.equal(meta.scaler_scale.length,    meta.n_features);

  const EXPECTED_CLASSES = ['Accuracy', 'Extreme', 'Speed', 'Standard', 'Tech'];
  assert.deepEqual([...meta.classes].sort(), EXPECTED_CLASSES,
    `unexpected classes: ${meta.classes}`);
});

// ── End-to-end inference ──────────────────────────────────────────────────────

async function loadClassifier() {
  const { loadClassifier: load } = await import('../src/classify.node.js');
  return load(MODEL_PATH, META_PATH);
}

function makeNotes(count, interval, colorAlt = true) {
  return Array.from({ length: count }, (_, i) => ({
    beat:      i * interval,
    x:         i % 2 === 0 ? 0 : 3,
    y:         1,
    color:     colorAlt ? i % 2 : 0,
    direction: i % 2 === 0 ? 1 : 0,
  }));
}

test('classifyFromNotes: output has correct shape and types', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const { classifyFromNotes } = await import('../src/infer.js');
  const clf = await loadClassifier();

  const notes = makeNotes(32, 0.25);
  const result = await classifyFromNotes(notes, [], [], [], 120, [], clf);

  assert.ok(typeof result.category === 'string',     'category should be a string');
  assert.ok(typeof result.confidence === 'number',   'confidence should be a number');
  assert.ok(typeof result.probabilities === 'object','probabilities should be an object');

  const CLASSES = ['Accuracy', 'Extreme', 'Speed', 'Standard', 'Tech'];
  for (const cls of CLASSES)
    assert.ok(cls in result.probabilities, `missing class in probabilities: ${cls}`);

  const sum = Object.values(result.probabilities).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.01, `probabilities should sum to ~1, got ${sum}`);

  assert.ok(result.confidence >= 0 && result.confidence <= 1,
    `confidence ${result.confidence} should be in [0,1]`);
  assert.ok(CLASSES.includes(result.category),
    `category "${result.category}" is not a known class`);
});

test('classifyFromNotes: very high eBPM stream scores highest on Speed or Extreme', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const { classifyFromNotes } = await import('../src/infer.js');
  const clf = await loadClassifier();

  // 64 alternating notes at 1/16 beat interval → ~800 eBPM at 200 BPM
  const notes = makeNotes(64, 0.0625);
  const { probabilities } = await classifyFromNotes(notes, [], [], [], 200, [], clf);

  const speedOrExtreme = probabilities['Speed'] + probabilities['Extreme'];
  assert.ok(speedOrExtreme > 0.5,
    `high-eBPM stream should favour Speed/Extreme, got ${JSON.stringify(probabilities)}`);
});

test('classifyFromNotes: very slow notes with no crossovers scores highest on Accuracy', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const { classifyFromNotes } = await import('../src/infer.js');
  const clf = await loadClassifier();

  // 16 slow notes at 2-beat intervals, canonical hand positions
  const notes = Array.from({ length: 16 }, (_, i) => ({
    beat:      i * 2,
    x:         i % 2 === 0 ? 0 : 3,
    y:         1,
    color:     i % 2,
    direction: i % 2 === 0 ? 1 : 0,
  }));
  const { category, probabilities } = await classifyFromNotes(notes, [], [], [], 120, [], clf);

  assert.ok(probabilities['Accuracy'] > 0.4,
    `slow no-crossover map should score high on Accuracy, got ${JSON.stringify(probabilities)}`);
  assert.equal(category, 'Accuracy',
    `expected Accuracy, got ${category}`);
});

test('classifyFromNotes: deterministic — same input gives same output', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const { classifyFromNotes } = await import('../src/infer.js');
  const clf = await loadClassifier();

  const notes = makeNotes(16, 0.25);
  const r1 = await classifyFromNotes(notes, [], [], [], 120, [], clf);
  const r2 = await classifyFromNotes(notes, [], [], [], 120, [], clf);

  assert.equal(r1.category, r2.category);
  assert.equal(r1.confidence, r2.confidence);
});
