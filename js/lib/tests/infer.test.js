'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preprocess } from '../src/infer.js';

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
  // NaN → 5.0, then (5.0 - 0.0) / 1.0 = 5.0
  assert.ok(Math.abs(vec[0] - 5.0) < 1e-6, `expected 5.0, got ${vec[0]}`);
  // 4.0 unchanged before scaling
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
  const meta = {
    imputer_medians: [0.0],
    scaler_mean:     [0.0],
    scaler_scale:    [1.0],
  };
  const result = preprocess(vec, meta);
  assert.ok(result === vec, 'preprocess should return the same Float32Array');
});

test('preprocess: handles multi-feature vectors correctly', () => {
  const values = [1, 2, 3, 4, 5];
  const vec = new Float32Array(values);
  const meta = {
    imputer_medians: new Array(5).fill(0),
    scaler_mean:     values.map(v => v - 1),   // shift by 1
    scaler_scale:    new Array(5).fill(2.0),    // divide by 2
  };
  preprocess(vec, meta);
  // (v - (v-1)) / 2 = 1/2 = 0.5 for all
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(vec[i] - 0.5) < 1e-6, `index ${i}: expected 0.5, got ${vec[i]}`);
  }
});
