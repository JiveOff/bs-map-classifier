'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotatePatterns } from '../src/patterns.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(beat, x, y, color, direction) {
  return { beat, x, y, color, direction };
}

function has(patterns, type) {
  return patterns.some(p => p.type === type);
}

function count(patterns, type) {
  return patterns.filter(p => p.type === type).length;
}

// ── Slot-based: quad ──────────────────────────────────────────────────────────

test('quad: 4 same-hand same-beat notes covering all 4 lanes', () => {
  const notes = [
    n(0, 0, 0, 0, 8), n(0, 1, 0, 0, 8), n(0, 2, 0, 0, 8), n(0, 3, 0, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'quad'), 'expected quad');
});

test('quad: not emitted when fewer than 4 lanes covered', () => {
  const notes = [
    n(0, 0, 0, 0, 8), n(0, 1, 0, 0, 8), n(0, 2, 0, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'quad'), 'should not detect quad with only 3 lanes');
});

test('quad: not emitted when 4 notes share the same lane', () => {
  const notes = [
    n(0, 1, 0, 0, 8), n(0, 1, 1, 0, 8), n(0, 1, 2, 0, 8), n(0, 1, 0, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'quad'), 'all same lane, not a quad');
});

// ── Slot-based: loloppe ───────────────────────────────────────────────────────

test('loloppe: same-beat same-hand same-direction adjacent-lane notes', () => {
  // Same direction (down=1), adjacent lanes (x=1 and x=2)
  const notes = [
    n(0, 1, 0, 0, 1), n(0, 2, 0, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'loloppe'), 'expected loloppe');
});

test('loloppe: not emitted for non-adjacent lanes', () => {
  const notes = [
    n(0, 0, 0, 0, 1), n(0, 2, 0, 0, 1),  // gap of 2 lanes
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'loloppe'), 'non-adjacent lanes should not be loloppe');
});

test('loloppe: not emitted for dot notes (direction=8)', () => {
  const notes = [
    n(0, 1, 0, 0, 8), n(0, 2, 0, 0, 8),  // dot notes excluded
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'loloppe'), 'dot notes should not be loloppe');
});

test('loloppe: not emitted for different directions', () => {
  const notes = [
    n(0, 1, 0, 0, 0), n(0, 2, 0, 0, 1),  // different directions
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'loloppe'), 'different directions should not be loloppe');
});

// ── Slot-based: handclap ──────────────────────────────────────────────────────

test('handclap: right-moving red and left-moving blue in same slot', () => {
  // RIGHT_DIRS = {3,5,7}, LEFT_DIRS = {2,4,6}
  const notes = [
    n(0, 0, 1, 0, 3),  // red, going right (dir=3)
    n(0, 3, 1, 1, 2),  // blue, going left (dir=2)
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'handclap'), 'expected handclap');
});

test('handclap: not emitted when red goes left and blue goes right', () => {
  const notes = [
    n(0, 0, 1, 0, 2),  // red, going left
    n(0, 3, 1, 1, 3),  // blue, going right
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'handclap'), 'reversed handclap should not match');
});

test('handclap: not emitted with dot notes', () => {
  const notes = [
    n(0, 0, 1, 0, 8),  // red, dot
    n(0, 3, 1, 1, 8),  // blue, dot
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'handclap'), 'dot notes cannot handclap');
});

// ── Slot-based: window ────────────────────────────────────────────────────────

test('window: same-color same-lane notes at y=0 and y=2 (middle layer absent)', () => {
  const notes = [
    n(0, 1, 0, 0, 8),  // red, x=1, bottom
    n(0, 1, 2, 0, 8),  // red, x=1, top — gap=2, only 2 notes < 3 expected → window
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'window'), 'expected window');
});

test('window: not emitted when all layers are filled', () => {
  const notes = [
    n(0, 1, 0, 0, 8),  // y=0
    n(0, 1, 1, 0, 8),  // y=1
    n(0, 1, 2, 0, 8),  // y=2 — 3 notes = yMax-yMin+1, no gap
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'window'), 'all layers filled, no window');
});

test('window: not emitted when layer gap is only 1', () => {
  const notes = [
    n(0, 1, 0, 0, 8),  // y=0
    n(0, 1, 1, 0, 8),  // y=1 — gap=1 < 2
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'window'), 'layer gap of 1 is not a window');
});

// ── Slot-based: flower ────────────────────────────────────────────────────────

test('flower: ≥3 same-color same-beat notes with ≥2 distinct non-dot directions', () => {
  const notes = [
    n(0, 0, 0, 0, 0),  // red, dir=up
    n(0, 1, 1, 0, 1),  // red, dir=down
    n(0, 2, 0, 0, 3),  // red, dir=right
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'flower'), 'expected flower');
});

test('flower: not emitted with fewer than 3 same-color notes in slot', () => {
  const notes = [
    n(0, 0, 0, 0, 0),
    n(0, 1, 0, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'flower'), 'only 2 notes, not a flower');
});

test('flower: not emitted when all non-dot notes share the same direction', () => {
  const notes = [
    n(0, 0, 0, 0, 1), n(0, 1, 0, 0, 1), n(0, 2, 0, 0, 1),  // all direction=down
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'flower'), 'only 1 distinct direction, not a flower');
});

// ── Per-note: face_note ───────────────────────────────────────────────────────

test('face_note: emitted for notes at x=1', () => {
  const { patterns } = annotatePatterns([n(0, 1, 0, 0, 8)], 120);
  assert.ok(has(patterns, 'face_note'));
});

test('face_note: emitted for notes at x=2', () => {
  const { patterns } = annotatePatterns([n(0, 2, 0, 0, 8)], 120);
  assert.ok(has(patterns, 'face_note'));
});

test('face_note: not emitted for outer lanes (x=0, x=3)', () => {
  const notes = [n(0, 0, 0, 0, 8), n(1, 3, 0, 1, 8)];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'face_note'));
});

// ── Per-note: dot_note ────────────────────────────────────────────────────────

test('dot_note: emitted for notes with direction=8', () => {
  const { patterns } = annotatePatterns([n(0, 0, 0, 0, 8)], 120);
  assert.ok(has(patterns, 'dot_note'));
});

test('dot_note: not emitted for directional notes', () => {
  const { patterns } = annotatePatterns([n(0, 0, 0, 0, 1)], 120);
  assert.ok(!has(patterns, 'dot_note'));
});

// ── Per-note: top_row_note ────────────────────────────────────────────────────

test('top_row_note: emitted for notes at y=2', () => {
  const { patterns } = annotatePatterns([n(0, 0, 2, 0, 8)], 120);
  assert.ok(has(patterns, 'top_row_note'));
});

test('top_row_note: not emitted for y=0 or y=1', () => {
  const notes = [n(0, 0, 0, 0, 8), n(1, 0, 1, 0, 8)];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'top_row_note'));
});

// ── Per-note: vision_block ────────────────────────────────────────────────────

test('vision_block: face note with follower 0.0625..0.5 beats later', () => {
  const notes = [
    n(0,   1, 0, 0, 8),  // face note (x=1)
    n(0.25, 0, 0, 1, 8), // follower 0.25 beats later — within window
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'vision_block'), 'expected vision_block');
});

test('vision_block: not emitted when follower is too close (< 0.0625 beats)', () => {
  const notes = [
    n(0,    1, 0, 0, 8),
    n(0.03, 0, 0, 1, 8),  // 0.03 < 0.0625 → too close
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vision_block'));
});

test('vision_block: not emitted when follower is too far (> 0.5 beats)', () => {
  const notes = [
    n(0,   1, 0, 0, 8),
    n(0.6, 0, 0, 1, 8),  // 0.6 > 0.5 → too far
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vision_block'));
});

test('vision_block: not emitted when first note is not a face note', () => {
  const notes = [
    n(0,    0, 0, 0, 8),  // x=0, not a face note
    n(0.25, 2, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vision_block'));
});

// ── Stream family: vibro_stream ───────────────────────────────────────────────

test('vibro_stream: ≥4 alternating-color notes with interval ≤ 0.14', () => {
  // 4 notes at 0.1 beat intervals, alternating red/blue
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.1, 3, 0, 1, 8),
    n(0.2, 0, 0, 0, 8), n(0.3, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'vibro_stream'), 'expected vibro_stream');
});

test('vibro_stream: not emitted when interval exceeds 0.14', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.2, 3, 0, 1, 8),  // 0.2 > 0.14
    n(0.4, 0, 0, 0, 8), n(0.6, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vibro_stream'), 'interval too large for vibro');
});

test('vibro_stream: not emitted for same-color consecutive notes', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.1, 3, 0, 0, 8),  // both red
    n(0.2, 0, 0, 0, 8), n(0.3, 3, 0, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vibro_stream'), 'same color is not vibro');
});

test('vibro_stream: requires at least 4 notes', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.1, 3, 0, 1, 8), n(0.2, 0, 0, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'vibro_stream'), 'only 3 notes, not enough for vibro');
});

// ── Stream family: jump_stream ────────────────────────────────────────────────

test('jump_stream: stream run with at least one same-beat double', () => {
  // 4-note stream with one double at the start
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.0, 3, 0, 1, 8),   // double (same beat, both colors)
    n(0.25, 0, 0, 0, 8), n(0.5, 3, 0, 1, 8),   // continues stream
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'jump_stream'), 'expected jump_stream');
});

test('jump_stream: not emitted for a plain stream with no doubles', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.25, 3, 0, 1, 8),
    n(0.5, 0, 0, 0, 8), n(0.75, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'jump_stream'), 'plain stream without doubles is not jump_stream');
});

// ── Stream family: piano_stream ───────────────────────────────────────────────

test('piano_stream: monotone-x stream with alternating up/down directions', () => {
  // x increases: 0,1,2,3; dirs alternate UP/DOWN (0 and 1)
  // UP_DIRS={0,4,5}, DOWN_DIRS={1,6,7}
  const notes = [
    n(0.0, 0, 0, 0, 0), n(0.25, 1, 0, 1, 1),
    n(0.5, 2, 0, 0, 0), n(0.75, 3, 0, 1, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'piano_stream'), 'expected piano_stream');
});

test('piano_stream: not emitted for non-monotone x', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0), n(0.25, 3, 0, 1, 1),  // x goes 0,3 (not monotone by 1)
    n(0.5, 1, 0, 0, 0), n(0.75, 2, 0, 1, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'piano_stream'), 'non-monotone x is not piano_stream');
});

// ── Stream family: croissant ──────────────────────────────────────────────────

test('croissant: 4-note alternating stream with crossing lane sequences', () => {
  // Colors: R B R B, intervals ≤ 0.28
  // Red x:  [2, 0] (going left) — c0 = [2, 0]: c0[0] > c0[1]
  // Blue x: [1, 3] (going right) — c1 = [1, 3]: c1[0] < c1[1] → cross ✓
  const notes = [
    n(0.0, 2, 0, 0, 8), n(0.25, 1, 0, 1, 8),
    n(0.5, 0, 0, 0, 8), n(0.75, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'croissant'), 'expected croissant');
});

test('croissant: not emitted when lanes move in the same direction (no crossing)', () => {
  // Red: [0,2] ascending, Blue: [1,3] ascending — parallel, not crossing
  const notes = [
    n(0.0, 0, 0, 0, 8), n(0.25, 1, 0, 1, 8),
    n(0.5, 2, 0, 0, 8), n(0.75, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'croissant'), 'parallel motion is not a croissant');
});

// ── Stream family: gallop ─────────────────────────────────────────────────────

test('gallop: R-B-R triple within 2× STREAM_MAX', () => {
  // a.color === c.color (both red) and b.color !== a.color (blue middle)
  const notes = [
    n(0.0, 0, 0, 0, 8),   // red
    n(0.15, 3, 0, 1, 8),  // blue
    n(0.3, 0, 0, 0, 8),   // red — total span 0.3 ≤ 0.56 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'gallop'), 'expected gallop');
});

test('gallop: B-R-B triple also counts', () => {
  const notes = [
    n(0.0, 3, 0, 1, 8),
    n(0.15, 0, 0, 0, 8),
    n(0.3, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'gallop'), 'B-R-B should also be a gallop');
});

test('gallop: not emitted when span exceeds 2× STREAM_MAX', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8),
    n(0.3, 3, 0, 1, 8),
    n(0.65, 0, 0, 0, 8),  // span 0.65 > 0.56
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'gallop'), 'span too large for gallop');
});

// ── Stream family: inline ─────────────────────────────────────────────────────

test('inline: alternating colors at same (x, y) within 0.5 beats', () => {
  const notes = [
    n(0.0,  1, 1, 0, 8),  // red at (1,1)
    n(0.25, 1, 1, 1, 8),  // blue at (1,1) 0.25 beats later
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'inline'), 'expected inline');
});

test('inline: not emitted when position differs', () => {
  const notes = [
    n(0.0,  1, 1, 0, 8),
    n(0.25, 2, 1, 1, 8),  // different x
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'inline'));
});

test('inline: not emitted when interval exceeds 0.5 beats', () => {
  const notes = [
    n(0.0, 1, 1, 0, 8),
    n(0.6, 1, 1, 1, 8),  // 0.6 > 0.5
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'inline'));
});

test('inline: not emitted for same-color consecutive notes', () => {
  const notes = [
    n(0.0,  1, 1, 0, 8),
    n(0.25, 1, 1, 0, 8),  // both red
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'inline'));
});

// ── Per-hand: triangle ────────────────────────────────────────────────────────

test('triangle: 3 consecutive same-hand non-dot notes rotating in same direction', () => {
  // Up(90°) → UpLeft(135°) → Left(180°): d1=45, d2=45, both CW (< 180) ✓
  // Directions: 0=Up, 4=UpLeft, 2=Left
  const notes = [
    n(0.0, 0, 0, 0, 0),  // red, Up
    n(0.5, 1, 1, 0, 4),  // red, UpLeft
    n(1.0, 2, 2, 0, 2),  // red, Left
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'triangle'), 'expected triangle');
});

test('triangle: not emitted for opposing directions (rotation reversal)', () => {
  // Up(90°) → Right(0°): d1=(0-90+360)%360=270 > 180 → fails
  const notes = [
    n(0.0, 0, 0, 0, 0),  // Up
    n(0.5, 1, 0, 0, 3),  // Right — d1=270 > 180
    n(1.0, 2, 0, 0, 1),  // Down
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'triangle'), 'direction change > 180° is not a triangle');
});

test('triangle: not emitted for dot notes', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8),
    n(0.5, 1, 0, 0, 8),  // dot notes are excluded from triangle check
    n(1.0, 2, 0, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'triangle'), 'dot notes cannot form triangles');
});

// ── Per-hand: flick ───────────────────────────────────────────────────────────

test('flick: same-hand consecutive notes within STREAM_MAX (0.28) beats', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8),
    n(0.2, 0, 0, 0, 8),  // same hand (red), 0.2 ≤ 0.28
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'flick'), 'expected flick');
});

test('flick: not emitted when interval exceeds STREAM_MAX', () => {
  const notes = [
    n(0.0, 0, 0, 0, 8),
    n(0.5, 0, 0, 0, 8),  // 0.5 > 0.28
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'flick'), 'interval too large for flick');
});

// ── Per-hand: paul ────────────────────────────────────────────────────────────

test('paul: same position + same direction, vibro interval, same hand', () => {
  const notes = [
    n(0.0,  1, 1, 0, 1),
    n(0.1,  1, 1, 0, 1),  // same x/y/dir, 0.1 ≤ 0.14 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'paul'), 'expected paul');
});

test('paul: not emitted when position differs', () => {
  const notes = [
    n(0.0, 1, 1, 0, 1),
    n(0.1, 2, 1, 0, 1),  // different x
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'paul'));
});

test('paul: not emitted when direction differs', () => {
  const notes = [
    n(0.0, 1, 1, 0, 1),
    n(0.1, 1, 1, 0, 0),  // different direction
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'paul'));
});

test('paul: not emitted when interval exceeds VIBRO_MAX (0.14)', () => {
  const notes = [
    n(0.0, 1, 1, 0, 1),
    n(0.2, 1, 1, 0, 1),  // 0.2 > 0.14
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'paul'));
});

// ── Per-hand: hook ────────────────────────────────────────────────────────────

test('hook: both-up same-hand notes within 1 beat with lane+layer change', () => {
  // UP_DIRS = {0,4,5}
  // p: dir=0(Up), n: dir=5(UpRight); both UP; |dx|=1 ≥ 1; |dy|=1 ≥ 1
  const notes = [
    n(0.0, 0, 0, 0, 0),  // red, Up, x=0 y=0
    n(0.5, 1, 1, 0, 5),  // red, UpRight, x=1 y=1 → Δx=1, Δy=1 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'hook'), 'expected hook');
});

test('hook: both-down also counts', () => {
  // DOWN_DIRS = {1,6,7}
  const notes = [
    n(0.0, 1, 2, 0, 1),  // red, Down, x=1 y=2
    n(0.5, 2, 1, 0, 7),  // red, DownRight, x=2 y=1 → Δx=1, Δy=1 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'hook'), 'both-down hook should be detected');
});

test('hook: not emitted when notes are more than 1 beat apart', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0),
    n(1.5, 1, 1, 0, 5),  // gap > 1.0
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'hook'));
});

test('hook: not emitted when only lane changes but not layer', () => {
  const notes = [
    n(0.0, 0, 1, 0, 0),  // red, Up, y=1
    n(0.5, 1, 1, 0, 5),  // red, UpRight, y=1 → Δy=0, no layer change
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'hook'));
});

// ── Per-hand: scoop ───────────────────────────────────────────────────────────

test('scoop: lateral-at-bottom note followed by up note within 1 beat', () => {
  // LATERAL_DIRS = {2,3,4,5,6,7}, UP_DIRS = {0,4,5}
  const notes = [
    n(0.0, 0, 0, 0, 3),  // red, Right (lateral), y=0 (bottom)
    n(0.5, 1, 1, 0, 0),  // red, Up — within 1 beat ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'scoop'), 'expected scoop');
});

test('scoop: not emitted when first note is not at y=0', () => {
  const notes = [
    n(0.0, 0, 1, 0, 3),  // y=1, not bottom
    n(0.5, 1, 2, 0, 0),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'scoop'));
});

test('scoop: not emitted when first note is not lateral', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0),  // Up (not lateral)
    n(0.5, 1, 1, 0, 0),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'scoop'), 'up note at bottom is not a scoop start');
});

// ── Per-hand: shrado ──────────────────────────────────────────────────────────

test('shrado: far-right DownRight note followed by up note on opposite side', () => {
  // farRight: x=3, dir=7 (DownRight)
  // next: UP dir, |dx| ≥ 2 from x=3
  const notes = [
    n(0.0, 3, 1, 0, 7),  // red, x=3, DownRight
    n(1.0, 0, 0, 0, 0),  // red, x=0, Up — |3-0|=3 ≥ 2, gap=1.0 ≤ 1.5 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'shrado'), 'expected shrado');
});

test('shrado: far-left DownLeft also counts', () => {
  // farLeft: x=0, dir=6 (DownLeft)
  const notes = [
    n(0.0, 0, 1, 0, 6),  // red, x=0, DownLeft
    n(1.0, 3, 0, 0, 0),  // red, x=3, Up — |0-3|=3 ≥ 2 ✓
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'shrado'), 'far-left shrado should be detected');
});

test('shrado: not emitted when x distance is less than 2', () => {
  const notes = [
    n(0.0, 3, 1, 0, 7),
    n(1.0, 2, 0, 0, 0),  // |3-2|=1 < 2
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'shrado'));
});

test('shrado: not emitted when gap exceeds 1.5 beats', () => {
  const notes = [
    n(0.0, 3, 1, 0, 7),
    n(2.0, 0, 0, 0, 0),  // gap 2.0 > 1.5
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'shrado'));
});

// ── Per-hand: arm_circle ──────────────────────────────────────────────────────

test('arm_circle: 4 monotone-x notes alternating up/down within 0.5 beats', () => {
  // x: 0,1,2,3 (allRight); dirs: Up(0), Down(1), Up(0), Down(1)
  const notes = [
    n(0.0,  0, 0, 0, 0),  // Up
    n(0.1,  1, 0, 0, 1),  // Down
    n(0.2,  2, 0, 0, 0),  // Up
    n(0.3,  3, 0, 0, 1),  // Down
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'arm_circle'), 'expected arm_circle');
});

test('arm_circle: not emitted when x is not monotone', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0), n(0.1, 2, 0, 0, 1),  // gap of 2
    n(0.2, 1, 0, 0, 0), n(0.3, 3, 0, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'arm_circle'), 'non-monotone x is not arm_circle');
});

test('arm_circle: not emitted when interval between notes exceeds 0.5 beats', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0), n(0.6, 1, 0, 0, 1),  // 0.6 > 0.5
    n(1.2, 2, 0, 0, 0), n(1.8, 3, 0, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'arm_circle'), 'interval too large for arm_circle');
});

test('arm_circle: not emitted when directions do not alternate up/down', () => {
  const notes = [
    n(0.0, 0, 0, 0, 0), n(0.1, 1, 0, 0, 0),  // Up, Up (same direction)
    n(0.2, 2, 0, 0, 1), n(0.3, 3, 0, 0, 0),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'arm_circle'), 'non-alternating dirs are not arm_circle');
});

// ── Per-hand: staircase ───────────────────────────────────────────────────────

test('staircase: 3 same-hand notes progressing in cut direction', () => {
  // UpRight (dir=5, angle=45°): atan2(Δy,Δx) should ≈ 45° for each step
  // n0→n1: dx=1, dy=1 → atan2(1,1)=45° → angleDiff(45,45)=0 ≤ 67.5 ✓
  const notes = [
    n(0.0, 0, 0, 0, 5),  // UpRight
    n(0.5, 1, 1, 0, 5),  // UpRight
    n(1.0, 2, 2, 0, 5),  // UpRight
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'staircase'), 'expected staircase');
});

test('staircase: requires at least 3 notes in the run', () => {
  const notes = [
    n(0.0, 0, 0, 0, 5),
    n(0.5, 1, 1, 0, 5),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'staircase'), 'only 2 notes, not a staircase');
});

test('staircase: resets when gap exceeds 1.5 beats', () => {
  // 2 valid steps then a gap, so run length stays at 2 → no staircase
  const notes = [
    n(0.0, 0, 0, 0, 5),
    n(0.5, 1, 1, 0, 5),
    n(3.0, 2, 2, 0, 5),  // gap 2.5 > 1.5 → resets
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'staircase'), 'gap breaks the staircase run');
});

// ── Per-hand: dot_spam ────────────────────────────────────────────────────────

test('dot_spam: 4+ consecutive same-position dot notes per hand within 0.5 beats', () => {
  const notes = [
    n(0.0, 1, 1, 0, 8), n(0.1, 1, 1, 0, 8),
    n(0.2, 1, 1, 0, 8), n(0.3, 1, 1, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(has(patterns, 'dot_spam'), 'expected dot_spam');
});

test('dot_spam: not emitted with only 3 notes', () => {
  const notes = [
    n(0.0, 1, 1, 0, 8), n(0.1, 1, 1, 0, 8), n(0.2, 1, 1, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'dot_spam'), 'only 3 notes, not dot_spam');
});

test('dot_spam: not emitted for non-dot notes', () => {
  const notes = [
    n(0.0, 1, 1, 0, 1), n(0.1, 1, 1, 0, 1),
    n(0.2, 1, 1, 0, 1), n(0.3, 1, 1, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'dot_spam'), 'directional notes are not dot_spam');
});

test('dot_spam: not emitted when position changes between notes', () => {
  const notes = [
    n(0.0, 1, 1, 0, 8), n(0.1, 2, 1, 0, 8),  // x changes
    n(0.2, 1, 1, 0, 8), n(0.3, 1, 1, 0, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  assert.ok(!has(patterns, 'dot_spam'), 'position change breaks dot_spam run');
});

// ── Wall/bomb: groove_wall ────────────────────────────────────────────────────

test('groove_wall: dodge wall with notes on the opposite side', () => {
  const obstacles = [{ beat: 1.0, x: 0, y: 0, w: 1, h: 5, duration: 1.0 }];
  const notes = [
    n(1.5, 2, 0, 1, 8),  // note on opposite side (x=2 ≥ 2 when wall at x=0)
  ];
  const { patterns } = annotatePatterns(notes, 120, {}, obstacles);
  assert.ok(has(patterns, 'groove_wall'), 'expected groove_wall');
});

test('groove_wall: not emitted when no notes are on the opposite side', () => {
  const obstacles = [{ beat: 1.0, x: 0, y: 0, w: 1, h: 5, duration: 1.0 }];
  const notes = [
    n(1.5, 0, 0, 0, 8),  // same side as wall (x=0)
  ];
  const { patterns } = annotatePatterns(notes, 120, {}, obstacles);
  assert.ok(!has(patterns, 'groove_wall'), 'same-side note is not groove_wall');
});

test('groove_wall: not emitted for wide walls (w > 2)', () => {
  const obstacles = [{ beat: 1.0, x: 0, y: 0, w: 3, h: 5, duration: 1.0 }];
  const notes = [n(1.5, 3, 0, 1, 8)];
  const { patterns } = annotatePatterns(notes, 120, {}, obstacles);
  assert.ok(!has(patterns, 'groove_wall'), 'wide wall (w=3) is not a groove wall');
});

test('groove_wall: not emitted for zero-duration walls', () => {
  const obstacles = [{ beat: 1.0, x: 0, y: 0, w: 1, h: 5, duration: 0 }];
  const notes = [n(1.5, 2, 0, 1, 8)];
  const { patterns } = annotatePatterns(notes, 120, {}, obstacles);
  assert.ok(!has(patterns, 'groove_wall'), 'zero-duration wall is ignored');
});

// ── Wall/bomb: bomb_reset ─────────────────────────────────────────────────────

test('bomb_reset: bomb between consecutive same-direction notes', () => {
  // Two red Down(dir=1) notes with angleDiff(270,270)=0 < 90
  // Bomb between them at beat 1.0
  const notes = [
    n(0.0, 0, 1, 0, 1),  // red, Down
    n(2.0, 0, 1, 0, 1),  // red, Down
  ];
  const bombs = [{ beat: 1.0, x: 0, y: 0, color: -1, direction: 8 }];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(has(patterns, 'bomb_reset'), 'expected bomb_reset');
});

test('bomb_reset: not emitted when no bomb is between the notes', () => {
  const notes = [
    n(0.0, 0, 1, 0, 1),
    n(2.0, 0, 1, 0, 1),
  ];
  const { patterns } = annotatePatterns(notes, 120, {}, [], []);
  assert.ok(!has(patterns, 'bomb_reset'));
});

test('bomb_reset: not emitted when notes have different directions (not a DD)', () => {
  // angleDiff(Up=90, Down=270) = 180 ≥ 90 → not a reset candidate
  const notes = [
    n(0.0, 0, 1, 0, 0),  // Up
    n(2.0, 0, 1, 0, 1),  // Down
  ];
  const bombs = [{ beat: 1.0, x: 0, y: 0, color: -1, direction: 8 }];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(!has(patterns, 'bomb_reset'), 'opposing directions are not a bomb reset');
});

// ── Wall/bomb: bomb_hold ──────────────────────────────────────────────────────

test('bomb_hold: note followed by ≥3 bombs within 1 beat', () => {
  const notes = [n(0.0, 1, 1, 0, 8)];
  const bombs = [
    { beat: 0.1, x: 3, y: 2, color: -1, direction: 8 },
    { beat: 0.3, x: 3, y: 2, color: -1, direction: 8 },
    { beat: 0.6, x: 3, y: 2, color: -1, direction: 8 },
  ];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(has(patterns, 'bomb_hold'), 'expected bomb_hold');
});

test('bomb_hold: not emitted with fewer than 3 bombs in window', () => {
  const notes = [n(0.0, 1, 1, 0, 8)];
  const bombs = [
    { beat: 0.1, x: 3, y: 2, color: -1, direction: 8 },
    { beat: 0.3, x: 3, y: 2, color: -1, direction: 8 },
  ];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(!has(patterns, 'bomb_hold'), 'only 2 bombs, not bomb_hold');
});

// ── Wall/bomb: hammer_hit ─────────────────────────────────────────────────────

test('hammer_hit: bomb near the saber exit path of a directional note', () => {
  // Note at x=1, y=1, dir=3 (Right): EXIT_DX[3]=1, EXIT_DY[3]=0 → exit at (2, 1)
  // Bomb must be at beat in (note.beat, note.beat + BEAT_TOL] → (0, 0.125]
  // and at |x - 2| ≤ 1, y = 1
  const notes = [n(0.0, 1, 1, 0, 3)];
  const bombs  = [{ beat: 0.05, x: 2, y: 1, color: -1, direction: 8 }];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(has(patterns, 'hammer_hit'), 'expected hammer_hit');
});

test('hammer_hit: not emitted for dot notes', () => {
  const notes = [n(0.0, 1, 1, 0, 8)];  // dot note has no exit direction
  const bombs  = [{ beat: 0.05, x: 2, y: 1, color: -1, direction: 8 }];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(!has(patterns, 'hammer_hit'), 'dot notes have no saber exit path');
});

test('hammer_hit: not emitted when bomb is not near the exit path', () => {
  // Note dir=3 (Right), exit at (2, 1); bomb at (0, 0) — far away
  const notes = [n(0.0, 1, 1, 0, 3)];
  const bombs  = [{ beat: 0.05, x: 0, y: 0, color: -1, direction: 8 }];
  const { patterns } = annotatePatterns(notes, 120, {}, [], bombs);
  assert.ok(!has(patterns, 'hammer_hit'), 'bomb is not near saber exit path');
});

// ── Backward compat: no obstacles/bombs still works ───────────────────────────

test('annotatePatterns: works without obstacles and bombs parameters', () => {
  const notes = [n(0, 1, 0, 0, 8), n(0, 2, 0, 1, 8)];
  assert.doesNotThrow(() => annotatePatterns(notes, 120));
  assert.doesNotThrow(() => annotatePatterns(notes, 120, { title: 'test' }));
});

// ── Pattern event count sanity ────────────────────────────────────────────────

test('all new pattern types produce at least beat and notes fields', () => {
  // Build a note set that triggers many new patterns at once
  const notes = [
    // face notes + dot notes + top row
    n(0, 1, 2, 0, 8), n(0, 2, 2, 1, 8),
    // quad
    n(4, 0, 0, 0, 8), n(4, 1, 0, 0, 8), n(4, 2, 0, 0, 8), n(4, 3, 0, 0, 8),
    // vibro stream (4 notes, interval 0.1)
    n(8, 0, 0, 0, 8), n(8.1, 3, 0, 1, 8), n(8.2, 0, 0, 0, 8), n(8.3, 3, 0, 1, 8),
  ];
  const { patterns } = annotatePatterns(notes, 120);
  for (const p of patterns) {
    assert.ok('beat'  in p, `pattern ${p.type} missing beat`);
    assert.ok('notes' in p, `pattern ${p.type} missing notes`);
    assert.ok('type'  in p, `pattern ${p.type} missing type`);
    assert.ok(Array.isArray(p.notes), `pattern ${p.type}.notes should be array`);
    assert.ok(p.notes.length >= 1, `pattern ${p.type} has no notes attached`);
    assert.ok(typeof p.beat === 'number', `pattern ${p.type}.beat should be number`);
  }
});
