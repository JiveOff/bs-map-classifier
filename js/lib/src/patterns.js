'use strict';
/**
 * patterns.js — visual pattern annotation for the Beat Saber overlay panel.
 *
 * annotatePatterns(notes, bpm, meta?, obstacles?, bombs?) returns a structured
 * list of pattern events suitable for rendering in a timeline.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DIR_ANGLES   = { 0: 90, 1: 270, 2: 180, 3: 0, 4: 135, 5: 45, 6: 225, 7: 315 };
const UP_DIRS      = new Set([0, 4, 5]);
const DOWN_DIRS    = new Set([1, 6, 7]);
const LEFT_DIRS    = new Set([2, 4, 6]);
const RIGHT_DIRS   = new Set([3, 5, 7]);
const LATERAL_DIRS = new Set([2, 3, 4, 5, 6, 7]);

const STREAM_MAX = 0.28;
const VIBRO_MAX  = 0.14;
const BEAT_TOL   = 1 / 8;
const STREAM_MIN = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// ── Colors and labels ─────────────────────────────────────────────────────────

export const PATTERN_COLORS = {
  // slot-based
  double:            '#f0b429',
  scissor:           '#f85149',
  crossover_scissor: '#ff7b72',
  stack:             '#d29922',
  tower:             '#db61a2',
  quad:              '#f43f5e',
  loloppe:           '#34d399',
  handclap:          '#f97316',
  window:            '#06b6d4',
  flower:            '#e11d48',
  // per-note
  crossover:         '#a371f7',
  invert:            '#58a6ff',
  face_note:         '#60a5fa',
  dot_note:          '#94a3b8',
  top_row_note:      '#fbbf24',
  vision_block:      '#ef4444',
  // streams / sequences
  stream:            '#3fb950',
  vibro_stream:      '#00e5ff',
  jump_stream:       '#26a641',
  piano_stream:      '#1a7f37',
  croissant:         '#f59e0b',
  gallop:            '#d97706',
  // per-hand sequences
  dd:                '#ffa657',
  jump:              '#39d353',
  flick:             '#fb923c',
  triangle:          '#e879f9',
  hook:              '#a855f7',
  scoop:             '#ec4899',
  shrado:            '#8b5cf6',
  arm_circle:        '#c084fc',
  staircase:         '#7c3aed',
  paul:              '#6b7280',
  dot_spam:          '#9ca3af',
  // inline
  inline:            '#14b8a6',
  // wall / bomb
  groove_wall:       '#22c55e',
  bomb_reset:        '#dc2626',
  bomb_hold:         '#9333ea',
  hammer_hit:        '#c026d3',
};

export const TYPE_LABELS = {
  double:            'Double',
  scissor:           'Scissor',
  crossover_scissor: 'Crossover Scissor',
  stack:             'Stack',
  tower:             'Tower',
  quad:              'Quad',
  loloppe:           'Loloppe',
  handclap:          'Handclap',
  window:            'Window',
  flower:            'Flower',
  crossover:         'Crossover',
  invert:            'Invert',
  face_note:         'Face Note',
  dot_note:          'Dot Note',
  top_row_note:      'Top Row Note',
  vision_block:      'Vision Block',
  stream:            'Stream',
  vibro_stream:      'Vibro Stream',
  jump_stream:       'Jump Stream',
  piano_stream:      'Piano Stream',
  croissant:         'Croissant',
  gallop:            'Gallop',
  dd:                'Double Directional',
  jump:              'Jump',
  flick:             'Flick',
  triangle:          'Triangle',
  hook:              'Hook',
  scoop:             'Scoop',
  shrado:            'Shrado',
  arm_circle:        'Arm Circle',
  staircase:         'Staircase',
  paul:              'Paul',
  dot_spam:          'Dot Spam',
  inline:            'Inline',
  groove_wall:       'Groove Wall',
  bomb_reset:        'Bomb Reset',
  bomb_hold:         'Bomb Hold',
  hammer_hit:        'Hammer Hit',
};

// ── annotatePatterns ──────────────────────────────────────────────────────────

/**
 * Annotate a note sequence with named pattern events.
 *
 * @param {object[]} notes     - parsed notes (beat, x, y, color, direction)
 * @param {number}   bpm
 * @param {object}   [meta]    - optional metadata (id, title, difficulty, …)
 * @param {object[]} [obstacles]
 * @param {object[]} [bombs]
 * @returns {{ meta, all_notes, patterns, colors }}
 */
export function annotatePatterns(notes, bpm, meta = {}, obstacles = [], bombs = []) {
  const N      = notes.length;
  const events = [];

  if (!N) return { meta, all_notes: [], patterns: [], colors: PATTERN_COLORS };

  function ts(beat)  { return Math.round(beat / bpm * 60 * 1000) / 1000; }

  function add(type, beat, pnotes, label = '') {
    events.push({
      type,
      label: label || TYPE_LABELS[type] || type,
      beat:  Math.round(beat * 10000) / 10000,
      time:  ts(beat),
      notes: pnotes.map(n => ({ ...n })),
    });
  }

  const left  = notes.filter(n => n.color === 0);
  const right = notes.filter(n => n.color === 1);

  // ── Slot grouping ─────────────────────────────────────────────────────────
  const slots = new Map();
  for (const n of notes) {
    const k = Math.round(n.beat / BEAT_TOL);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(n);
  }
  const sortedSlots = [...slots].sort((a, b) => a[0] - b[0]).map(([, g]) => g);

  // ── Slot-based patterns ───────────────────────────────────────────────────
  const stacksForVb = []; // [{beat, lane}] for vision_block pass

  for (const grp of sortedSlots) {
    const beat  = Math.min(...grp.map(n => n.beat));
    const reds  = grp.filter(n => n.color === 0);
    const blues = grp.filter(n => n.color === 1);

    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      if (!hand.length) continue;

      // Quad: 4+ same-hand notes covering all 4 lanes
      if (hand.length >= 4 && new Set(hand.map(n => n.x)).size === 4)
        add('quad', beat, hand);

      // Stack / Tower
      const byLane = new Map();
      for (const n of hand) {
        if (!byLane.has(n.x)) byLane.set(n.x, []);
        byLane.get(n.x).push(n);
      }
      for (const [lane, col] of byLane) {
        if (col.length >= 3) { add('tower', beat, col); stacksForVb.push({ beat, lane }); }
        else if (col.length === 2) { add('stack', beat, col); stacksForVb.push({ beat, lane }); }
      }

      // Flower: ≥2 same-color notes at same (x,y) with different directions ≤90° apart
      const byPos = new Map();
      for (const n of hand) {
        const k = `${n.x},${n.y}`;
        if (!byPos.has(k)) byPos.set(k, []);
        byPos.get(k).push(n);
      }
      for (const posNotes of byPos.values()) {
        const dp = posNotes.filter(n => n.direction !== 8);
        for (let pi = 0; pi < dp.length; pi++) {
          for (let pj = pi + 1; pj < dp.length; pj++) {
            if (angleDiff(DIR_ANGLES[dp[pi].direction], DIR_ANGLES[dp[pj].direction]) <= 90)
              add('flower', beat, [dp[pi], dp[pj]]);
          }
        }
      }

      // Loloppe: same-beat same-hand same-direction adjacent-lane notes
      if (hand.length >= 2) {
        const hd = hand.filter(n => n.direction !== 8);
        for (let i = 0; i < hd.length; i++) {
          for (let j = i + 1; j < hd.length; j++) {
            const a = hd[i], b = hd[j];
            if (a.direction === b.direction &&
                Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) <= 1)
              add('loloppe', beat, [a, b]);
          }
        }
      }
    }

    // Window: any note at y=0 AND y=2 with no note at y=1 in the slot
    {
      const allYs = new Set(grp.map(n => n.y));
      if (allYs.has(0) && allYs.has(2) && !allYs.has(1))
        add('window', beat, grp);
    }

    // Handclap: right-moving red + left-moving blue, adjacent lanes (|Δx| ≤ 1)
    {
      const rd = reds.filter(n => n.direction !== 8);
      const bd = blues.filter(n => n.direction !== 8);
      let found = false;
      for (const r of rd) {
        if (found) break;
        if (RIGHT_DIRS.has(r.direction)) {
          for (const b of bd) {
            if (LEFT_DIRS.has(b.direction) && Math.abs(r.x - b.x) <= 1) {
              add('handclap', beat, [r, b]); found = true; break;
            }
          }
        }
      }
    }

    if (!reds.length || !blues.length) continue;

    const rd = reds.filter(n => n.direction !== 8);
    const bd = blues.filter(n => n.direction !== 8);

    // Crossover Scissor
    const rc = rd.filter(n => n.x >= 2);
    const bc = bd.filter(n => n.x <= 1);
    if (rc.length && bc.length &&
        angleDiff(DIR_ANGLES[rc[0].direction], DIR_ANGLES[bc[0].direction]) >= 150) {
      add('crossover_scissor', beat, [rc[0], bc[0]]);
      continue;
    }

    // Scissor / Double
    const isScissor = rd.some(r => bd.some(b =>
      angleDiff(DIR_ANGLES[r.direction], DIR_ANGLES[b.direction]) >= 150));
    add(isScissor ? 'scissor' : 'double', beat, [reds[0], blues[0]]);
  }

  // ── Per-note patterns ─────────────────────────────────────────────────────
  for (const n of notes) {
    if ((n.color === 0 && n.x >= 2) || (n.color === 1 && n.x <= 1))
      add('crossover', n.beat, [n]);

    if (n.direction !== 8) {
      const inv = n.color === 0
        ? (RIGHT_DIRS.has(n.direction) && n.x <= 1) || (LEFT_DIRS.has(n.direction) && n.x >= 2)
        : (LEFT_DIRS.has(n.direction)  && n.x >= 2) || (RIGHT_DIRS.has(n.direction) && n.x <= 1);
      if (inv) add('invert', n.beat, [n]);
    }

    if (n.x === 1 || n.x === 2) add('face_note',    n.beat, [n]);
    if (n.direction === 8)       add('dot_note',     n.beat, [n]);
    if (n.y === 2)               add('top_row_note', n.beat, [n]);
  }

  // ── Inline: alternating colors at same (x,y) within 0.5 beats, with parity ─
  for (let i = 1; i < N; i++) {
    const p = notes[i - 1], n = notes[i];
    if (!(n.color !== p.color && n.x === p.x && n.y === p.y &&
          n.beat - p.beat > 0 && n.beat - p.beat <= 0.5)) continue;
    // Parity: if both have directions, they must be in opposite families
    if (p.direction !== 8 && n.direction !== 8) {
      if (UP_DIRS.has(p.direction) === UP_DIRS.has(n.direction)) continue;
    }
    add('inline', p.beat, [p, n]);
  }

  // ── Vision blocks: stack/tower hiding a following note in same/adjacent lane ─
  for (const { beat: sb, lane: sl } of stacksForVb) {
    for (let j = 0; j < N; j++) {
      const gap = notes[j].beat - sb;
      if (gap <= 0.0624) continue;
      if (gap > 0.5) break;
      if (Math.abs(notes[j].x - sl) <= 1) { add('vision_block', sb, [notes[j]]); break; }
    }
  }

  // ── Stream family ─────────────────────────────────────────────────────────
  // Stream
  {
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
  }

  // Vibro stream
  {
    let run = [notes[0]];
    for (let i = 1; i < N; i++) {
      const iv = notes[i].beat - notes[i - 1].beat;
      if (iv > 0 && iv <= VIBRO_MAX && notes[i].color !== notes[i - 1].color) {
        run.push(notes[i]);
      } else {
        if (run.length >= STREAM_MIN) add('vibro_stream', run[0].beat, run, `Vibro ×${run.length}`);
        run = [notes[i]];
      }
    }
    if (run.length >= STREAM_MIN) add('vibro_stream', run[0].beat, run, `Vibro ×${run.length}`);
  }

  // Jump stream: stream run with ≥1 same-beat double
  {
    let run = [notes[0]], hasDouble = false;
    for (let i = 1; i < N; i++) {
      const p = notes[i - 1], cur = notes[i];
      const iv       = cur.beat - p.beat;
      const sameSlot = iv <= BEAT_TOL;
      const altSingle = iv > 0 && iv <= STREAM_MAX && cur.color !== p.color;
      if (sameSlot || altSingle) {
        run.push(cur);
        if (sameSlot && cur.color !== p.color) hasDouble = true;
      } else {
        if (run.length >= STREAM_MIN && hasDouble)
          add('jump_stream', run[0].beat, run, `Jump Stream ×${run.length}`);
        run = [cur]; hasDouble = false;
      }
    }
    if (run.length >= STREAM_MIN && hasDouble)
      add('jump_stream', run[0].beat, run, `Jump Stream ×${run.length}`);
  }

  // Piano stream: monotone-x stream with alternating up/down directions
  {
    let buf = [notes[0]];
    const tryPiano = (b) => {
      if (b.length < STREAM_MIN) return;
      for (let s = 0; s <= b.length - STREAM_MIN; s++) {
        const w  = b.slice(s, s + STREAM_MIN);
        const xs = w.map(n => n.x);
        const mono = xs.every((x, k) => k === 0 || x > xs[k - 1]) ||
                     xs.every((x, k) => k === 0 || x < xs[k - 1]);
        if (!mono) continue;
        const nd = w.map(n => n.direction).filter(d => d !== 8);
        if (nd.length >= 3 && nd.every((d, k) =>
          k === 0 || UP_DIRS.has(nd[k]) !== UP_DIRS.has(nd[k - 1])
        )) { add('piano_stream', w[0].beat, w); break; }
      }
    };
    for (let i = 1; i < N; i++) {
      const iv = notes[i].beat - notes[i - 1].beat;
      if (iv > 0 && iv <= STREAM_MAX && notes[i].color !== notes[i - 1].color) {
        buf.push(notes[i]);
      } else {
        tryPiano(buf);
        buf = [notes[i]];
      }
    }
    tryPiano(buf);
  }

  // Croissant: 4-note alternating stream with crossing lane sequences per hand
  for (let i = 0; i <= N - 4; i++) {
    const w = notes.slice(i, i + 4);
    if (![0, 1, 2].every(k => w[k].color !== w[k + 1].color)) continue;
    if (![0, 1, 2].every(k => {
      const iv = w[k + 1].beat - w[k].beat;
      return iv > 0 && iv <= STREAM_MAX;
    })) continue;
    const c0 = w.filter(n => n.color === w[0].color).map(n => n.x);
    const c1 = w.filter(n => n.color !== w[0].color).map(n => n.x);
    if (c0.length === 2 && c1.length === 2) {
      const cross = (c0[0] > c0[1] && c1[0] < c1[1]) || (c0[0] < c0[1] && c1[0] > c1[1]);
      if (cross) add('croissant', w[0].beat, w);
    }
  }

  // Gallop: R-B-B or B-R-R triple within 2× STREAM_MAX
  for (let i = 1; i < N - 1; i++) {
    const a = notes[i - 1], b = notes[i], c = notes[i + 1];
    if (c.beat - a.beat > STREAM_MAX * 2) continue;
    if (a.color === c.color && a.color !== b.color) add('gallop', a.beat, [a, b, c]);
  }

  // ── Per-hand patterns ─────────────────────────────────────────────────────
  for (const hand of [left, right]) {
    if (!hand.length) continue;
    const dh = hand.filter(n => n.direction !== 8);

    // DD
    for (let i = 1; i < dh.length; i++) {
      if (angleDiff(DIR_ANGLES[dh[i - 1].direction], DIR_ANGLES[dh[i].direction]) < 90)
        add('dd', dh[i].beat, [dh[i - 1], dh[i]]);
    }

    // Triangle: 3 consecutive non-dot notes rotating in the same direction
    for (let i = 2; i < dh.length; i++) {
      const a0 = DIR_ANGLES[dh[i - 2].direction];
      const a1 = DIR_ANGLES[dh[i - 1].direction];
      const a2 = DIR_ANGLES[dh[i].direction];
      const d1 = (a1 - a0 + 360) % 360, d2 = (a2 - a1 + 360) % 360;
      const cw1 = d1 < 180, cw2 = d2 < 180;
      if (cw1 === cw2 && d1 > 0 && d1 < 180 && d2 > 0 && d2 < 180)
        add('triangle', dh[i - 2].beat, [dh[i - 2], dh[i - 1], dh[i]]);
    }

    // Jump: grid distance ≥ 2 between consecutive same-hand notes within 2 beats
    for (let i = 1; i < hand.length; i++) {
      const dt = hand[i].beat - hand[i - 1].beat;
      const dx = hand[i].x - hand[i - 1].x, dy = hand[i].y - hand[i - 1].y;
      if (dt <= 2 && Math.sqrt(dx * dx + dy * dy) >= 2)
        add('jump', hand[i].beat, [hand[i - 1], hand[i]]);
    }

    // Flick: same-hand consecutive notes within STREAM_MAX
    for (let i = 1; i < hand.length; i++) {
      const iv = hand[i].beat - hand[i - 1].beat;
      if (iv > 0 && iv <= STREAM_MAX) add('flick', hand[i - 1].beat, [hand[i - 1], hand[i]]);
    }

    // Paul: same position + same direction, vibro interval, same hand (dot notes included)
    for (let i = 1; i < hand.length; i++) {
      const p = hand[i - 1], n = hand[i];
      const iv = n.beat - p.beat;
      if (n.x === p.x && n.y === p.y && n.direction === p.direction &&
          iv > 0 && iv <= VIBRO_MAX)
        add('paul', p.beat, [p, n]);
    }

    // Hook: direction reversal (down→up or up→down), same layer, adjacent lanes
    for (let i = 1; i < dh.length; i++) {
      const p = dh[i - 1], n = dh[i];
      if (n.beat - p.beat > 1.0) continue;
      const reversal = (DOWN_DIRS.has(p.direction) && UP_DIRS.has(n.direction)) ||
                       (UP_DIRS.has(p.direction)   && DOWN_DIRS.has(n.direction));
      if (reversal && Math.abs(n.x - p.x) <= 1 && n.y === p.y)
        add('hook', p.beat, [p, n]);
    }

    // Scoop: lateral-at-bottom → up within 1 beat
    for (let i = 1; i < dh.length; i++) {
      const p = dh[i - 1], n = dh[i];
      if (n.beat - p.beat > 1.0) continue;
      if (LATERAL_DIRS.has(p.direction) && p.y === 0 && UP_DIRS.has(n.direction))
        add('scoop', p.beat, [p, n]);
    }

    // Shrado: far-corner diagonal-down → opposite-side upswing within 1.5 beats
    for (let i = 1; i < dh.length; i++) {
      const p = dh[i - 1], n = dh[i];
      if (n.beat - p.beat > 1.5) continue;
      const farRight = p.x === 3 && p.direction === 7;
      const farLeft  = p.x === 0 && p.direction === 6;
      if ((farRight || farLeft) && UP_DIRS.has(n.direction) && Math.abs(n.x - p.x) >= 2)
        add('shrado', p.beat, [p, n]);
    }

    // Arm circle: 4-note monotone-x, alternating up/down, all within 0.5 beats
    {
      let ai = 0;
      while (ai < hand.length - 3) {
        const w = hand.slice(ai, ai + 4);
        if (w.some(n => n.direction === 8) ||
            w.slice(1).some((n, k) => n.beat - w[k].beat > 0.5)) { ai++; continue; }
        const dxs      = [w[1].x - w[0].x, w[2].x - w[1].x, w[3].x - w[2].x];
        const allRight = dxs.every(d => d >= 1), allLeft = dxs.every(d => d <= -1);
        if (!allRight && !allLeft) { ai++; continue; }
        const dirs = w.map(n => n.direction);
        const alts = [0, 1, 2].every(k => UP_DIRS.has(dirs[k]) !== UP_DIRS.has(dirs[k + 1]));
        if (alts) { add('arm_circle', w[0].beat, w); ai += 4; } else ai++;
      }
    }

    // Staircase: progressive-movement run ≥ 3 notes
    {
      let sStart = 0, sLen = 1;
      for (let i = 1; i < hand.length; i++) {
        const p = hand[i - 1], n = hand[i];
        let extend = false;
        if (n.beat - p.beat <= 1.5) {
          const dx = n.x - p.x, dy = n.y - p.y;
          if (dx !== 0 || dy !== 0) {
            if (p.direction === 8) {
              extend = true;
            } else {
              const expected = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
              extend = angleDiff(DIR_ANGLES[p.direction], expected) <= 67.5;
            }
          }
        }
        if (extend) {
          sLen++;
        } else {
          if (sLen >= 3) add('staircase', hand[sStart].beat, hand.slice(sStart, sStart + sLen));
          sStart = i; sLen = 1;
        }
      }
      if (sLen >= 3) add('staircase', hand[sStart].beat, hand.slice(sStart, sStart + sLen));
    }

    // Dot spam: 4+ consecutive same-position dot notes per hand
    {
      const dots = hand.filter(n => n.direction === 8);
      if (dots.length >= 4) {
        let dStart = 0, dLen = 1;
        for (let i = 1; i < dots.length; i++) {
          if (dots[i].x === dots[i - 1].x && dots[i].y === dots[i - 1].y &&
              dots[i].beat - dots[i - 1].beat <= 0.5) {
            dLen++;
          } else {
            if (dLen >= 4) add('dot_spam', dots[dStart].beat, dots.slice(dStart, dStart + dLen), `Dot Spam ×${dLen}`);
            dStart = i; dLen = 1;
          }
        }
        if (dLen >= 4) add('dot_spam', dots[dStart].beat, dots.slice(dStart, dStart + dLen), `Dot Spam ×${dLen}`);
      }
    }
  }

  // ── Groove walls ──────────────────────────────────────────────────────────
  for (const obs of obstacles) {
    if (obs.w > 2 || obs.duration <= 0) continue;
    const obsEnd    = obs.beat + obs.duration;
    const wallNotes = notes.filter(n => n.beat >= obs.beat - 0.25 && n.beat <= obsEnd + 0.25);
    const opposite  = obs.x <= 1
      ? wallNotes.filter(n => n.x >= 2)
      : wallNotes.filter(n => n.x <= 1);
    if (opposite.length) add('groove_wall', obs.beat, opposite);
  }

  // ── Bomb patterns ─────────────────────────────────────────────────────────
  if (bombs.length) {
    const bSorted = [...bombs].sort((a, b) => a.beat - b.beat);
    const bBeats  = bSorted.map(b => b.beat);

    function bisectRight(val) {
      let lo = 0, hi = bBeats.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (bBeats[mid] <= val) lo = mid + 1; else hi = mid; }
      return lo;
    }
    function bisectLeft(val) {
      let lo = 0, hi = bBeats.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (bBeats[mid] < val) lo = mid + 1; else hi = mid; }
      return lo;
    }

    // Bomb reset: bomb between consecutive same-direction notes (potential parity reset)
    for (const hand of [left, right]) {
      const dh = hand.filter(n => n.direction !== 8);
      for (let i = 1; i < dh.length; i++) {
        const p = dh[i - 1], cur = dh[i];
        if (angleDiff(DIR_ANGLES[p.direction], DIR_ANGLES[cur.direction]) < 90) {
          const lo = bisectRight(p.beat + BEAT_TOL);
          const hi = bisectLeft(cur.beat);
          if (lo < hi) add('bomb_reset', p.beat, [p, cur]);
        }
      }
    }

    // Bomb hold: note followed by ≥3 bombs within 1 beat
    for (const n of notes) {
      const lo = bisectRight(n.beat + 0.0625);
      const hi = bisectRight(n.beat + 1.0);
      if (hi - lo >= 3) add('bomb_hold', n.beat, [n]);
    }

    // Hammer hit: bomb near the saber exit path of a directional note
    const EXIT_DX = { 0: 0, 1: 0, 2: -1, 3: 1, 4: -1, 5: 1, 6: -1, 7: 1 };
    const EXIT_DY = { 0: 1, 1: -1, 2: 0, 3: 0, 4: 1, 5: 1, 6: -1, 7: -1 };
    for (const n of notes) {
      if (n.direction === 8) continue;
      const ex = n.x + EXIT_DX[n.direction];
      const ey = n.y + EXIT_DY[n.direction];
      const lo = bisectRight(n.beat);
      const hi = bisectRight(n.beat + BEAT_TOL);
      for (let k = lo; k < hi; k++) {
        if (Math.abs(bSorted[k].x - ex) <= 1 && bSorted[k].y === ey) {
          add('hammer_hit', n.beat, [n]); break;
        }
      }
    }
  }

  events.sort((a, b) => a.beat - b.beat);
  return { meta, all_notes: notes.map(n => ({ ...n })), patterns: events, colors: PATTERN_COLORS };
}
