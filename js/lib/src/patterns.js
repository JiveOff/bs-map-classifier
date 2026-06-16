'use strict';
/**
 * patterns.js — visual pattern annotation for the Beat Saber overlay panel.
 *
 * annotatePatterns(notes, bpm, meta?) returns a structured list of pattern
 * events (beat, type, notes involved) suitable for rendering in a timeline.
 * This is distinct from the statistical feature extraction in features.js —
 * the goal here is per-event labelling for the viewer UI.
 */

const DIR_ANGLES = { 0: 90, 1: 270, 2: 180, 3: 0, 4: 135, 5: 45, 6: 225, 7: 315 };

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

export const PATTERN_COLORS = {
  double:            '#f0b429',
  scissor:           '#f85149',
  crossover:         '#a371f7',
  crossover_scissor: '#ff7b72',
  stack:             '#d29922',
  tower:             '#db61a2',
  stream:            '#3fb950',
  dd:                '#ffa657',
  jump:              '#39d353',
  invert:            '#58a6ff',
};

export const TYPE_LABELS = {
  double:            'Double',
  scissor:           'Scissor',
  crossover:         'Crossover',
  crossover_scissor: 'Crossover Scissor',
  stack:             'Stack',
  tower:             'Tower',
  stream:            'Stream',
  dd:                'Double Directional',
  jump:              'Jump',
  invert:            'Invert',
};

/**
 * Annotate a note sequence with named pattern events.
 *
 * @param {object[]} notes  - parsed notes (beat, x, y, color, direction)
 * @param {number}   bpm
 * @param {object}   [meta] - optional metadata (id, title, difficulty, …)
 * @returns {{ meta, all_notes, patterns, colors }}
 */
export function annotatePatterns(notes, bpm, meta = {}) {
  const BEAT_TOL   = 1 / 8;
  const STREAM_MAX = 0.28;
  const STREAM_MIN = 4;
  const N          = notes.length;
  const events     = [];

  if (!N) return { meta, all_notes: [], patterns: [], colors: PATTERN_COLORS };

  function ts(beat) { return Math.round(beat / bpm * 60 * 1000) / 1000; }

  function add(type, beat, pnotes, label = '') {
    events.push({
      type,
      label: label || TYPE_LABELS[type] || type,
      beat:  Math.round(beat * 10000) / 10000,
      time:  ts(beat),
      notes: pnotes.map(n => ({ ...n })),
    });
  }

  // Group notes into 1/8-beat slots
  const slots = new Map();
  for (const n of notes) {
    const k = Math.round(n.beat / BEAT_TOL);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(n);
  }

  // Doubles, Scissors, CrossoverScissors, Stacks, Towers
  for (const [, grp] of [...slots].sort((a, b) => a[0] - b[0])) {
    const beat  = Math.min(...grp.map(n => n.beat));
    const reds  = grp.filter(n => n.color === 0);
    const blues = grp.filter(n => n.color === 1);

    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      if (hand.length < 2) continue;
      const byLane = new Map();
      for (const n of hand) {
        if (!byLane.has(n.x)) byLane.set(n.x, []);
        byLane.get(n.x).push(n);
      }
      for (const col of byLane.values()) {
        if (col.length >= 3)      add('tower', beat, col);
        else if (col.length === 2) add('stack', beat, col);
      }
    }

    if (!reds.length || !blues.length) continue;

    const rd = reds.filter(n => n.direction !== 8);
    const bd = blues.filter(n => n.direction !== 8);

    const rc = rd.filter(n => n.x >= 2);
    const bc = bd.filter(n => n.x <= 1);
    if (rc.length && bc.length &&
        angleDiff(DIR_ANGLES[rc[0].direction], DIR_ANGLES[bc[0].direction]) >= 150) {
      add('crossover_scissor', beat, [rc[0], bc[0]]);
      continue;
    }

    const isScissor = rd.some(r => bd.some(b =>
      angleDiff(DIR_ANGLES[r.direction], DIR_ANGLES[b.direction]) >= 150));
    add(isScissor ? 'scissor' : 'double', beat, [reds[0], blues[0]]);
  }

  // Crossovers, Inverts
  for (const n of notes) {
    if ((n.color === 0 && n.x >= 2) || (n.color === 1 && n.x <= 1))
      add('crossover', n.beat, [n]);

    if (n.direction !== 8) {
      const inv = n.color === 0
        ? ([3, 5, 7].includes(n.direction) && n.x <= 1) || ([2, 4, 6].includes(n.direction) && n.x >= 2)
        : ([2, 4, 6].includes(n.direction) && n.x >= 2) || ([3, 5, 7].includes(n.direction) && n.x <= 1);
      if (inv) add('invert', n.beat, [n]);
    }
  }

  // Streams
  let run = [notes[0]];
  for (let i = 1; i < N; i++) {
    const iv = notes[i].beat - notes[i - 1].beat;
    if (iv > 0 && iv <= STREAM_MAX && notes[i].color !== notes[i - 1].color) {
      run.push(notes[i]);
    } else {
      if (run.length >= STREAM_MIN) add('stream', run[0].beat, run, `Stream ×${run.length}`);
      run = [notes[i]];
    }
  }
  if (run.length >= STREAM_MIN) add('stream', run[0].beat, run, `Stream ×${run.length}`);

  // DDs, Jumps (per hand)
  for (const hand of [notes.filter(n => n.color === 0), notes.filter(n => n.color === 1)]) {
    const dh = hand.filter(n => n.direction !== 8);
    for (let i = 1; i < dh.length; i++) {
      if (angleDiff(DIR_ANGLES[dh[i - 1].direction], DIR_ANGLES[dh[i].direction]) < 90)
        add('dd', dh[i].beat, [dh[i - 1], dh[i]]);
    }
    for (let i = 1; i < hand.length; i++) {
      const dx = hand[i].x - hand[i - 1].x, dy = hand[i].y - hand[i - 1].y;
      if (Math.sqrt(dx * dx + dy * dy) >= 2) add('jump', hand[i].beat, [hand[i - 1], hand[i]]);
    }
  }

  events.sort((a, b) => a.beat - b.beat);
  return { meta, all_notes: notes.map(n => ({ ...n })), patterns: events, colors: PATTERN_COLORS };
}
