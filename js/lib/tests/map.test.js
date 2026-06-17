'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPatterns, classifyMap, extractPatternsAndClassifyMap, parseMap } from '../src/map.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(__dirname, '../../../models/onnx/pattern_classifier.onnx');
const META_PATH  = resolve(__dirname, '../../../models/onnx/pattern_classifier_meta.json');
const MODEL_EXISTS = existsSync(MODEL_PATH) && existsSync(META_PATH);

async function loadClassifier() {
  const { loadClassifier: load } = await import('../src/classify.node.js');
  return load(MODEL_PATH, META_PATH);
}

// Simple alternating stream — enough notes for all features to be non-trivial
function makeStream(count = 32, interval = 0.25, bpm = 120) {
  return {
    notes: Array.from({ length: count }, (_, i) => ({
      beat: i * interval, x: i % 2 === 0 ? 0 : 3,
      y: 1, color: i % 2, direction: i % 2 === 0 ? 1 : 0,
    })),
    obstacles: [],
    arcs: [],
    chains: [],
    bombs: [],
    bpm,
  };
}

// ── extractPatterns ───────────────────────────────────────────────────────────

test('extractPatterns: returns features, patterns, patternColors, allNotes', () => {
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = extractPatterns({ notes, obstacles, arcs, chains, bombs }, bpm);

  assert.ok(result.features && typeof result.features === 'object', 'features should be an object');
  assert.ok(Array.isArray(result.patterns),                         'patterns should be an array');
  assert.ok(result.patternColors && typeof result.patternColors === 'object');
  assert.ok(Array.isArray(result.allNotes),                         'allNotes should be an array');
});

test('extractPatterns: features include expected keys', () => {
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const { features } = extractPatterns({ notes, obstacles, arcs, chains, bombs }, bpm);

  for (const key of ['lane_0_rate', 'ebpm_left_mean', 'njs', 'jump_distance', 'sps_total_avg'])
    assert.ok(key in features, `expected feature key "${key}" to be present`);
});

test('extractPatterns: njs/njsOffset picked up from parsedBeatmap', () => {
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const withNjs    = extractPatterns({ notes, obstacles, arcs, chains, bombs, njs: 18, njsOffset: 0.5 }, bpm);
  const withoutNjs = extractPatterns({ notes, obstacles, arcs, chains, bombs }, bpm);

  assert.equal(withNjs.features.njs, 18);
  assert.notEqual(withNjs.features.jump_distance, withoutNjs.features.jump_distance,
    'jump_distance should differ when njs differs');
});

test('extractPatterns: allNotes length equals input note count', () => {
  const count = 20;
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream(count);
  const { allNotes } = extractPatterns({ notes, obstacles, arcs, chains, bombs }, bpm);
  assert.equal(allNotes.length, count);
});

test('extractPatterns: passes meta to annotatePatterns', () => {
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  // Should not throw when meta is provided
  const result = extractPatterns({ notes, obstacles, arcs, chains, bombs }, bpm, { id: 'test', category: 'Speed' });
  assert.ok(Array.isArray(result.patterns));
});

// ── classifyMap ───────────────────────────────────────────────────────────────

test('classifyMap: returns category, confidence, probabilities', {
  skip: !MODEL_EXISTS ? 'model files not found — run export_onnx.py first' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = await classifyMap({ notes, obstacles, arcs, chains, bombs }, bpm, clf);

  assert.ok(typeof result.category === 'string');
  assert.ok(typeof result.confidence === 'number');
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(typeof result.probabilities === 'object');
  const CLASSES = ['Accuracy', 'Extreme', 'Speed', 'Standard', 'Tech'];
  for (const cls of CLASSES)
    assert.ok(cls in result.probabilities, `missing class "${cls}"`);
});

test('classifyMap: njs/njsOffset picked up from parsedBeatmap', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  // Should not throw when njs is embedded in the object
  const result = await classifyMap({ notes, obstacles, arcs, chains, bombs, njs: 16, njsOffset: 0 }, bpm, clf);
  assert.ok(typeof result.category === 'string');
});

test('classifyMap: explicit njs param overrides parsedBeatmap.njs', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  // Explicit param (njs=20) should override parsedBeatmap.njs=10
  const r1 = await classifyMap({ notes, obstacles, arcs, chains, bombs, njs: 10 }, bpm, clf, 20);
  const r2 = await classifyMap({ notes, obstacles, arcs, chains, bombs, njs: 20 }, bpm, clf);
  assert.deepEqual(r1.probabilities, r2.probabilities,
    'explicit njs=20 and embedded njs=20 should produce identical results');
});

// ── extractPatternsAndClassifyMap ─────────────────────────────────────────────

test('extractPatternsAndClassifyMap: returns all expected fields', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = await extractPatternsAndClassifyMap(
    { notes, obstacles, arcs, chains, bombs }, bpm, clf,
  );

  assert.ok(result.features && typeof result.features === 'object', 'features missing');
  assert.ok(Array.isArray(result.patterns),                         'patterns missing');
  assert.ok(result.patternColors && typeof result.patternColors === 'object');
  assert.ok(Array.isArray(result.allNotes),                         'allNotes missing');
  assert.ok(result.classification && typeof result.classification === 'object', 'classification missing');
  assert.ok(typeof result.classification.category === 'string');
});

test('extractPatternsAndClassifyMap: njs/njsOffset from parsedBeatmap flow into features', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = await extractPatternsAndClassifyMap(
    { notes, obstacles, arcs, chains, bombs, njs: 18, njsOffset: 0.5 }, bpm, clf,
  );

  assert.equal(result.features.njs, 18,
    'features.njs should reflect the value embedded in parsedBeatmap');
  assert.ok(result.features.jump_distance > 0, 'jump_distance should be positive');
});

test('extractPatternsAndClassifyMap: features and classification are consistent', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const { features, classification } = await extractPatternsAndClassifyMap(
    { notes, obstacles, arcs, chains, bombs }, bpm, clf,
  );

  // The top class in classification.probabilities should match classification.category
  const topClass = Object.entries(classification.probabilities)
    .sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(classification.category, topClass);

  // Features object should have nps_mapped > 0 for a non-trivial map
  assert.ok(features.nps_mapped > 0, 'nps_mapped should be positive');
});

// ── parseMap (deprecated) ─────────────────────────────────────────────────────

test('parseMap: without classifier delegates to extractPatterns', async () => {
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = await parseMap({ notes, obstacles, arcs, chains, bombs }, bpm);

  assert.ok(result.features && typeof result.features === 'object');
  assert.ok(Array.isArray(result.patterns));
  assert.ok(!('classification' in result), 'should not have classification without a classifier');
});

test('parseMap: with classifier delegates to extractPatternsAndClassifyMap', {
  skip: !MODEL_EXISTS ? 'model files not found' : false,
}, async () => {
  const clf = await loadClassifier();
  const { notes, obstacles, arcs, chains, bombs, bpm } = makeStream();
  const result = await parseMap({ notes, obstacles, arcs, chains, bombs }, bpm, clf);

  assert.ok(result.features && typeof result.features === 'object');
  assert.ok(result.classification && typeof result.classification.category === 'string');
});
