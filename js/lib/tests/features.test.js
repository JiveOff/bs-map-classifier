'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, toFeatureVector } from '../src/features.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function note(beat, x, y, color, direction) {
  return { beat, x, y, color, direction };
}

// ── computeFeatures — empty input ─────────────────────────────────────────────

test('computeFeatures: empty notes returns an object without throwing', () => {
  const feats = computeFeatures([], [], [], [], 120, []);
  assert.equal(typeof feats, 'object');
  // Histogram features default to 0 or are absent when there are no notes
  assert.equal(feats.lane_0_rate ?? 0, 0);
  assert.equal(feats.lane_1_rate ?? 0, 0);
  assert.equal(feats.lane_2_rate ?? 0, 0);
  assert.equal(feats.lane_3_rate ?? 0, 0);
  assert.equal(feats.left_note_rate ?? 0, 0);
});

// ── Lane rates ────────────────────────────────────────────────────────────────

test('computeFeatures: lane rates sum to 1 for all-same-lane notes', () => {
  const notes = [
    note(0.0, 0, 1, 0, 1),
    note(0.5, 0, 1, 1, 0),
    note(1.0, 0, 1, 0, 1),
    note(1.5, 0, 1, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.equal(feats.lane_0_rate, 1.0);
  assert.equal(feats.lane_1_rate, 0.0);
  assert.equal(feats.lane_2_rate, 0.0);
  assert.equal(feats.lane_3_rate, 0.0);
});

test('computeFeatures: lane rates sum to 1 across all lanes', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 1, 0, 1, 0),
    note(1.0, 2, 0, 0, 1),
    note(1.5, 3, 0, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  const sum = feats.lane_0_rate + feats.lane_1_rate + feats.lane_2_rate + feats.lane_3_rate;
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `lane rate sum should be 1, got ${sum}`);
});

// ── Layer rates ───────────────────────────────────────────────────────────────

test('computeFeatures: layer_2_rate is 1 when all notes are in top layer', () => {
  const notes = [
    note(0.0, 0, 2, 0, 1),
    note(0.5, 1, 2, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  // top_row_rate alias removed — use layer_2_rate directly
  assert.equal(feats.layer_2_rate, 1.0);
  assert.equal(feats.layer_0_rate, 0.0);
  assert.equal(feats.top_row_rate, undefined);
});

// ── Hand balance ──────────────────────────────────────────────────────────────

test('computeFeatures: left_note_rate is 1 for all red (color=0) notes', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 1, 0, 0, 0),
    note(1.0, 2, 0, 0, 1),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.equal(feats.left_note_rate, 1.0);
});

test('computeFeatures: left_note_rate is 0 for all blue (color=1) notes', () => {
  const notes = [
    note(0.0, 0, 0, 1, 1),
    note(0.5, 1, 0, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.equal(feats.left_note_rate, 0.0);
});

test('computeFeatures: left_note_rate is 0.5 for balanced notes', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 3, 0, 1, 0),
    note(1.0, 0, 0, 0, 1),
    note(1.5, 3, 0, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.equal(feats.left_note_rate, 0.5);
});

// ── Direction rates ───────────────────────────────────────────────────────────

test('computeFeatures: dir_8_rate is 1 for all dot notes (dir=8)', () => {
  const notes = [
    note(0.0, 0, 0, 0, 8),
    note(0.5, 1, 0, 1, 8),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  // dot_note_rate alias removed — use dir_8_rate directly
  assert.equal(feats.dir_8_rate, 1.0);
  assert.equal(feats.dot_note_rate, undefined);
});

test('computeFeatures: direction rates sum to 1', () => {
  const notes = [
    note(0.0, 0, 0, 0, 0),
    note(0.5, 1, 0, 1, 1),
    note(1.0, 2, 0, 0, 3),
    note(1.5, 3, 0, 1, 8),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  const dirSum = [0,1,2,3,4,5,6,7,8].reduce((s, d) => s + (feats[`dir_${d}_rate`] || 0), 0);
  assert.ok(Math.abs(dirSum - 1.0) < 1e-9, `direction rate sum should be 1, got ${dirSum}`);
});

// ── eBPM ──────────────────────────────────────────────────────────────────────

test('computeFeatures: ebpm_max_overall is non-negative', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 0, 0, 0, 0),
    note(1.0, 0, 0, 0, 1),
    note(1.5, 0, 0, 0, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.ok(feats.ebpm_max_overall >= 0);
});

// ── Obstacles ─────────────────────────────────────────────────────────────────

test('computeFeatures: wall_density is non-negative', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(2.0, 1, 0, 1, 0),
  ];
  const obstacles = [
    { beat: 0.5, x: 1, y: 0, w: 1, h: 5, duration: 1.0 },
  ];
  const feats = computeFeatures(notes, obstacles, [], [], 120);
  assert.ok(feats.wall_density >= 0);
});

// ── toFeatureVector ───────────────────────────────────────────────────────────

test('toFeatureVector: returns Float32Array of correct length', () => {
  const feats = computeFeatures([], [], [], [], 120);
  const names = ['lane_0_rate', 'lane_1_rate', 'lane_2_rate', 'lane_3_rate'];
  const vec = toFeatureVector(feats, names);
  assert.ok(vec instanceof Float32Array, 'should be Float32Array');
  assert.equal(vec.length, 4);
});

test('toFeatureVector: missing features default to 0', () => {
  const featureMap = { lane_0_rate: 0.5 };
  const names = ['lane_0_rate', 'nonexistent_feature'];
  const vec = toFeatureVector(featureMap, names);
  assert.equal(vec[0], 0.5);
  assert.equal(vec[1], 0);
});

test('toFeatureVector: preserves correct order', () => {
  const featureMap = { a: 1.0, b: 2.0, c: 3.0 };
  const names = ['c', 'a', 'b'];
  const vec = toFeatureVector(featureMap, names);
  assert.equal(vec[0], 3.0);
  assert.equal(vec[1], 1.0);
  assert.equal(vec[2], 2.0);
});

// ── Arc/chain rates ───────────────────────────────────────────────────────────

test('computeFeatures: arc_rate is 0 with no arcs (chain_rate removed — near-zero importance)', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 3, 0, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  assert.equal(feats.arc_rate, 0);
  assert.equal(feats.arc_count, 0);
  // chain_rate and chain_count removed from feature set
  assert.equal(feats.chain_rate, undefined);
});

// ── Feature object completeness ───────────────────────────────────────────────

test('computeFeatures: returns all expected base feature keys', () => {
  const notes = [
    note(0.0, 0, 1, 0, 1),
    note(0.5, 3, 1, 1, 0),
  ];
  const feats = computeFeatures(notes, [], [], [], 120);
  const expected = [
    'lane_0_rate', 'lane_1_rate', 'lane_2_rate', 'lane_3_rate',
    'layer_0_rate', 'layer_1_rate', 'layer_2_rate',
    // top_row_rate removed (alias of layer_2_rate)
    'dir_0_rate', 'dir_8_rate',
    // dot_note_rate removed (alias of dir_8_rate)
    'left_note_rate', 'hand_imbalance',
    'dd_rate_left', 'dd_rate_right', 'dd_rate_total',
    'ebpm_max_overall',
    'arc_rate',
    // chain_rate removed (near-zero importance)
    'wall_density',
  ];
  for (const key of expected) {
    assert.ok(key in feats, `missing feature: ${key}`);
    assert.ok(typeof feats[key] === 'number', `feature ${key} should be a number`);
    assert.ok(isFinite(feats[key]) || feats[key] === 0, `feature ${key} should be finite`);
  }
});
