'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotatePatterns, PATTERN_COLORS, TYPE_LABELS } from '../src/patterns.js';

function note(beat, x, y, color, direction) {
  return { beat, x, y, color, direction };
}

// ── Return structure ──────────────────────────────────────────────────────────

test('annotatePatterns: returns correct shape', () => {
  const result = annotatePatterns([], 120);
  assert.ok('meta'      in result, 'missing meta');
  assert.ok('all_notes' in result, 'missing all_notes');
  assert.ok('patterns'  in result, 'missing patterns');
  assert.ok('colors'    in result, 'missing colors');
  assert.ok(Array.isArray(result.all_notes));
  assert.ok(Array.isArray(result.patterns));
});

test('annotatePatterns: empty notes produces empty patterns', () => {
  const { patterns, all_notes } = annotatePatterns([], 120);
  assert.equal(patterns.length, 0);
  assert.equal(all_notes.length, 0);
});

test('annotatePatterns: all_notes contains every input note', () => {
  const notes = [
    note(0.0, 0, 0, 0, 1),
    note(0.5, 3, 0, 1, 0),
    note(1.0, 1, 1, 0, 1),
  ];
  const { all_notes } = annotatePatterns(notes, 120);
  assert.equal(all_notes.length, 3);
});

// ── Double detection ──────────────────────────────────────────────────────────

test('annotatePatterns: detects a double (same-beat left+right, dot notes)', () => {
  // Dot notes (direction=8) are excluded from the scissor/crossover-scissor angle check,
  // so same-beat left+right dot notes are always classified as a double.
  const notes = [
    note(0.0, 1, 1, 0, 8),  // left, centre-left, dot
    note(0.0, 2, 1, 1, 8),  // right, centre-right, dot
  ];
  const { patterns } = annotatePatterns(notes, 120);
  const doubles = patterns.filter(p => p.type === 'double');
  assert.ok(doubles.length >= 1, 'expected at least one double');
});

// ── Scissor detection ─────────────────────────────────────────────────────────

test('annotatePatterns: detects a scissor (opposing directions, inner lanes)', () => {
  // Scissor requires non-dot notes with angle diff >= 150°.
  // Using inner lanes (red x≤1, blue x≥2) avoids the crossover_scissor branch
  // which takes priority and would consume these notes before the scissor check.
  // Dir 1=Down (270°) vs Dir 0=Up (90°): angleDiff = 180 >= 150 → scissor.
  const notes = [
    note(0.0, 1, 1, 0, 1),  // left hand, centre-left, direction Down
    note(0.0, 2, 1, 1, 0),  // right hand, centre-right, direction Up
  ];
  const { patterns } = annotatePatterns(notes, 120);
  const scissors = patterns.filter(p => p.type === 'scissor');
  assert.ok(scissors.length >= 1, 'expected at least one scissor');
});

// ── Pattern object shape ──────────────────────────────────────────────────────

test('annotatePatterns: pattern events have required fields', () => {
  const notes = [
    note(0.0, 1, 1, 0, 1),
    note(0.0, 2, 1, 1, 0),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  if (patterns.length > 0) {
    const p = patterns[0];
    assert.ok('type'  in p, 'pattern missing type');
    assert.ok('beat'  in p, 'pattern missing beat');
    assert.ok('notes' in p, 'pattern missing notes');
    assert.equal(typeof p.type, 'string');
    assert.equal(typeof p.beat, 'number');
    assert.ok(Array.isArray(p.notes));
  }
});

// ── PATTERN_COLORS and TYPE_LABELS exports ────────────────────────────────────

test('PATTERN_COLORS: is a non-empty object with string values', () => {
  assert.ok(typeof PATTERN_COLORS === 'object' && PATTERN_COLORS !== null);
  const keys = Object.keys(PATTERN_COLORS);
  assert.ok(keys.length > 0);
  for (const val of Object.values(PATTERN_COLORS)) {
    assert.equal(typeof val, 'string');
    assert.ok(val.startsWith('#'), `color should be a hex color, got ${val}`);
  }
});

test('TYPE_LABELS: is a non-empty object with string values', () => {
  assert.ok(typeof TYPE_LABELS === 'object' && TYPE_LABELS !== null);
  const keys = Object.keys(TYPE_LABELS);
  assert.ok(keys.length > 0);
  for (const val of Object.values(TYPE_LABELS)) {
    assert.equal(typeof val, 'string');
  }
});

test('TYPE_LABELS: has matching keys with PATTERN_COLORS', () => {
  for (const key of Object.keys(PATTERN_COLORS)) {
    assert.ok(key in TYPE_LABELS, `PATTERN_COLORS key "${key}" missing from TYPE_LABELS`);
  }
});

// ── meta passthrough ──────────────────────────────────────────────────────────

test('annotatePatterns: passes meta through to result', () => {
  const meta = { id: 'abc123', title: 'Test Song', difficulty: 'ExpertPlus' };
  const { meta: outMeta } = annotatePatterns([], 120, meta);
  assert.deepEqual(outMeta, meta);
});
