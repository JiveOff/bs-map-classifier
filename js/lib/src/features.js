'use strict';
/**
 * features.js — JavaScript port of map_parser.py
 *
 * Computes the 202-feature vector expected by pattern_classifier.onnx.
 * Input: parsed beatmap objects (notes, obstacles, arcs, chains, bombs).
 * Output: plain object keyed by feature name, or Float32Array in model order.
 *
 * Feature order is defined by pattern_classifier_meta.json → "features" array.
 *
 * Grid reference:
 *   Lanes  (x): 0=far-left … 3=far-right
 *   Layers (y): 0=bottom   … 2=top
 *   Dir: 0=Up 1=Down 2=Left 3=Right 4=UpLeft 5=UpRight 6=DownLeft 7=DownRight 8=dot
 *   Color: 0=red(left) 1=blue(right)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DIR_ANGLES = { 0: 90, 1: 270, 2: 180, 3: 0, 4: 135, 5: 45, 6: 225, 7: 315 };

const UP_DIRS      = new Set([0, 4, 5]);
const DOWN_DIRS    = new Set([1, 6, 7]);
const LEFT_DIRS    = new Set([2, 4, 6]);
const RIGHT_DIRS   = new Set([3, 5, 7]);
const LATERAL_DIRS = new Set([2, 3, 4, 5, 6, 7]);

const STREAM_MAX_INTERVAL = 0.28;
const VIBRO_MAX_INTERVAL  = 0.14;
const BEAT_TOL            = 1 / 8;
const WINDOW_BEATS        = 16.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function safe(v) {
  return (v === null || v === undefined || !isFinite(v)) ? 0.0 : v;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr) { return percentile(arr, 50); }

// Group notes into 1/8-beat slots → Map<slot_int, Note[]>
function makeSlots(notes, tol = BEAT_TOL) {
  const m = new Map();
  for (const n of notes) {
    const k = Math.round(n.beat / tol);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  }
  return m;
}

// ── Obstacle helpers ──────────────────────────────────────────────────────────

function isCrouch(o) { return o.y >= 2 || (o.h <= 3 && o.y > 0); }
function isDodge(o)  { return o.w === 1 && !isCrouch(o); }

// ── DD rate helper ────────────────────────────────────────────────────────────

function ddRate(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  if (dh.length < 2) return 0;
  let breaks = 0;
  for (let i = 1; i < dh.length; i++) {
    if (angleDiff(DIR_ANGLES[dh[i-1].direction], DIR_ANGLES[dh[i].direction]) < 90) breaks++;
  }
  return breaks / (dh.length - 1);
}

// ── eBPM stats ────────────────────────────────────────────────────────────────

function ebpmStats(hand, bpm) {
  if (hand.length < 2) return { mean: 0, median: 0, max: 0, p90: 0 };
  const intervals = [];
  for (let i = 1; i < hand.length; i++) {
    const iv = hand[i].beat - hand[i-1].beat;
    if (iv >= 0.05) intervals.push(iv);
  }
  if (!intervals.length) return { mean: 0, median: 0, max: 0, p90: 0 };
  const ebpms = intervals.map(iv => bpm * 0.5 / iv);
  return {
    mean:   mean(ebpms),
    median: median(ebpms),
    max:    Math.max(...ebpms),
    p90:    percentile(ebpms, 90),
  };
}

// ── Timing variability (CV) ───────────────────────────────────────────────────

function intervalCV(hand) {
  if (hand.length < 3) return 0;
  const intervals = [];
  for (let i = 1; i < hand.length; i++) {
    const iv = hand[i].beat - hand[i-1].beat;
    if (iv >= 0.05) intervals.push(iv);
  }
  const m = mean(intervals);
  return m > 0 ? std(intervals) / m : 0;
}

// ── Mean rotation ─────────────────────────────────────────────────────────────

function meanRotation(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  if (dh.length < 2) return 0;
  const rots = [];
  for (let i = 1; i < dh.length; i++) {
    rots.push(angleDiff(DIR_ANGLES[dh[i-1].direction], DIR_ANGLES[dh[i].direction]));
  }
  return mean(rots);
}

// ── Pattern count helpers ─────────────────────────────────────────────────────

function countDD(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  let c = 0;
  for (let i = 1; i < dh.length; i++) {
    if (angleDiff(DIR_ANGLES[dh[i-1].direction], DIR_ANGLES[dh[i].direction]) < 90) c++;
  }
  return c;
}

function countTriangles(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  let c = 0;
  for (let i = 2; i < dh.length; i++) {
    const a0 = DIR_ANGLES[dh[i-2].direction];
    const a1 = DIR_ANGLES[dh[i-1].direction];
    const a2 = DIR_ANGLES[dh[i].direction];
    const d1 = (a1 - a0 + 360) % 360;
    const d2 = (a2 - a1 + 360) % 360;
    const cw1 = d1 < 180, cw2 = d2 < 180;
    if (cw1 === cw2 && d1 > 0 && d1 < 180 && d2 > 0 && d2 < 180) c++;
  }
  return c;
}

function countJumps(hand) {
  let c = 0;
  for (let i = 1; i < hand.length; i++) {
    const dx = hand[i].x - hand[i-1].x, dy = hand[i].y - hand[i-1].y;
    if (Math.sqrt(dx*dx + dy*dy) >= 2) c++;
  }
  return c;
}

function countInline(notes) {
  // alternating-color consecutive notes at same (x,y)
  let c = 0;
  for (let i = 1; i < notes.length; i++) {
    const p = notes[i-1], n = notes[i];
    if (n.color !== p.color && n.x === p.x && n.y === p.y &&
        n.beat - p.beat > 0 && n.beat - p.beat <= 0.5) c++;
  }
  return c;
}

function countHooks(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  let c = 0;
  for (let i = 1; i < dh.length; i++) {
    const p = dh[i-1], n = dh[i];
    if (n.beat - p.beat > 1.0) continue;
    const bothUp   = UP_DIRS.has(p.direction)   && UP_DIRS.has(n.direction);
    const bothDown = DOWN_DIRS.has(p.direction) && DOWN_DIRS.has(n.direction);
    if ((bothUp || bothDown) && Math.abs(n.x - p.x) >= 1 && Math.abs(n.y - p.y) >= 1) c++;
  }
  return c;
}

function countScoops(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  let c = 0;
  for (let i = 1; i < dh.length; i++) {
    const p = dh[i-1], n = dh[i];
    if (n.beat - p.beat > 1.0) continue;
    if (LATERAL_DIRS.has(p.direction) && p.y === 0 && UP_DIRS.has(n.direction)) c++;
  }
  return c;
}

function countShrados(hand) {
  const dh = hand.filter(n => n.direction !== 8);
  let c = 0;
  for (let i = 1; i < dh.length; i++) {
    const p = dh[i-1], n = dh[i];
    if (n.beat - p.beat > 1.5) continue;
    const farRight = p.x === 3 && p.direction === 7;
    const farLeft  = p.x === 0 && p.direction === 6;
    if ((farRight || farLeft) && UP_DIRS.has(n.direction) && Math.abs(n.x - p.x) >= 2) c++;
  }
  return c;
}

function countArmCircles(hand) {
  let c = 0, i = 0;
  while (i < hand.length - 3) {
    const w = hand.slice(i, i + 4);
    if (w.some(n => n.direction === 8) ||
        w.slice(1).some((n, k) => n.beat - w[k].beat > 0.5)) { i++; continue; }
    const dxs = [w[1].x - w[0].x, w[2].x - w[1].x, w[3].x - w[2].x];
    const allRight = dxs.every(d => d >= 1), allLeft = dxs.every(d => d <= -1);
    if (!allRight && !allLeft) { i++; continue; }
    const dirs = w.map(n => n.direction);
    const alts = [0,1,2].every(k =>
      UP_DIRS.has(dirs[k]) !== UP_DIRS.has(dirs[k+1])
    );
    if (alts) { c++; i += 4; } else i++;
  }
  return c;
}

function countStaircases(hand) {
  let c = 0, runLen = 1;
  for (let i = 1; i < hand.length; i++) {
    const p = hand[i-1], n = hand[i];
    if (n.beat - p.beat > 1.5) { if (runLen >= 3) c++; runLen = 1; continue; }
    const dx = n.x - p.x, dy = n.y - p.y;
    if (dx === 0 && dy === 0) { if (runLen >= 3) c++; runLen = 1; continue; }
    if (p.direction !== 8) {
      const expected = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      if (angleDiff(DIR_ANGLES[p.direction], expected) <= 67.5) runLen++;
      else { if (runLen >= 3) c++; runLen = 1; }
    } else runLen++;
  }
  if (runLen >= 3) c++;
  return c;
}

function countPaul(hand) {
  let c = 0;
  for (let i = 1; i < hand.length; i++) {
    const p = hand[i-1], n = hand[i];
    const iv = n.beat - p.beat;
    // Python does NOT exclude dot notes — same direction (incl. 8=dot) at same position
    if (n.x === p.x && n.y === p.y && n.direction === p.direction &&
        iv > 0 && iv <= VIBRO_MAX_INTERVAL) c++;
  }
  return c;
}

function countDotSpam(hand) {
  const dots = hand.filter(n => n.direction === 8);
  let c = 0, runL = 1;
  for (let i = 1; i < dots.length; i++) {
    if (dots[i].x === dots[i-1].x && dots[i].y === dots[i-1].y &&
        dots[i].beat - dots[i-1].beat <= 0.5) runL++;
    else { if (runL >= 4) c++; runL = 1; }
  }
  if (runL >= 4) c++;
  return c;
}

// ── countPatterns — direct port of map_parser.py count_patterns() ─────────────

function countPatterns(notes, bpm, obstacles = [], bombs = []) {
  const counts = {};
  const n = notes.length;
  if (!n) return counts;

  const left  = notes.filter(n => n.color === 0);
  const right = notes.filter(n => n.color === 1);

  const slots = makeSlots(notes);

  // Doubles
  let nDoubles = 0;
  for (const grp of slots.values()) {
    if (grp.some(n => n.color === 0) && grp.some(n => n.color === 1)) nDoubles++;
  }
  counts.n_doubles = nDoubles;

  // Scissor: count once per red note that has any scissor-match blue (mirrors Python)
  let nScissor = 0;
  for (const grp of slots.values()) {
    const reds  = grp.filter(n => n.color === 0 && n.direction !== 8);
    const blues = grp.filter(n => n.color === 1 && n.direction !== 8);
    if (reds.length && blues.length) {
      for (const r of reds) {
        for (const b of blues) {
          if (angleDiff(DIR_ANGLES[r.direction], DIR_ANGLES[b.direction]) >= 150) {
            nScissor++;
            break; // only break inner loop (per-red), not outer
          }
        }
      }
    }
  }
  counts.n_scissor = nScissor;

  // Stacks and towers
  let nStacks = 0, nTowers = 0;
  for (const grp of slots.values()) {
    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      if (hand.length < 2) continue;
      const cols = new Map();
      for (const n of hand) {
        const k = `${n.direction},${n.x}`;
        if (!cols.has(k)) cols.set(k, []);
        cols.get(k).push(n);
      }
      for (const col of cols.values()) {
        if (col.length >= 3) nTowers++;
        else if (col.length === 2) nStacks++;
      }
    }
  }
  counts.n_stacks = nStacks;
  counts.n_towers = nTowers;

  // Face notes, dot notes, top-row notes
  counts.n_face_notes    = notes.filter(n => n.x === 1 || n.x === 2).length;
  counts.n_dot_notes     = notes.filter(n => n.direction === 8).length;
  counts.n_top_row_notes = notes.filter(n => n.y === 2).length;

  // Crossovers
  counts.n_crossovers = notes.filter(
    n => (n.color === 0 && n.x >= 2) || (n.color === 1 && n.x <= 1)
  ).length;

  // Crossover scissor
  let nXscissor = 0;
  for (const grp of slots.values()) {
    const reds  = grp.filter(n => n.color === 0 && n.x >= 2 && n.direction !== 8);
    const blues = grp.filter(n => n.color === 1 && n.x <= 1 && n.direction !== 8);
    if (reds.length && blues.length) nXscissor++;
  }
  counts.n_crossover_scissor = nXscissor;

  // Inline (alternating-color at same x,y)
  counts.n_inline = countInline(notes);

  // DD
  counts.n_dd = countDD(left) + countDD(right);

  // Triangles
  counts.n_triangles = countTriangles(left) + countTriangles(right);

  // Jumps
  counts.n_jumps = countJumps(left) + countJumps(right);

  // Inverts
  let nInvert = 0;
  for (const n of notes) {
    if (n.direction === 8) continue;
    if (n.color === 0) {
      if ((RIGHT_DIRS.has(n.direction) && n.x <= 1) ||
          (LEFT_DIRS.has(n.direction) && n.x >= 2)) nInvert++;
    } else {
      if ((LEFT_DIRS.has(n.direction) && n.x >= 2) ||
          (RIGHT_DIRS.has(n.direction) && n.x <= 1)) nInvert++;
    }
  }
  counts.n_inverts = nInvert;

  // Streams
  let streamRuns = 0, streamNotes = 0, longestStream = 0, runLen = 1;
  for (let i = 1; i < n; i++) {
    const iv = notes[i].beat - notes[i-1].beat;
    if (iv > 0 && iv <= STREAM_MAX_INTERVAL && notes[i].color !== notes[i-1].color) {
      runLen++;
    } else {
      if (runLen >= 4) { streamRuns++; streamNotes += runLen; longestStream = Math.max(longestStream, runLen); }
      runLen = 1;
    }
  }
  if (runLen >= 4) { streamRuns++; streamNotes += runLen; longestStream = Math.max(longestStream, runLen); }
  counts.n_stream_runs  = streamRuns;
  counts.n_stream_notes = streamNotes;
  counts.longest_stream = longestStream;

  // Vibro
  let vibroNotes = 0;
  for (let i = 1; i < n; i++) {
    const iv = notes[i].beat - notes[i-1].beat;
    if (iv > 0 && iv <= VIBRO_MAX_INTERVAL && notes[i].color !== notes[i-1].color) vibroNotes++;
  }
  counts.n_vibro_notes = vibroNotes;

  // Flicks (same-hand close notes)
  const flicks = (hand) => {
    let c = 0;
    for (let i = 1; i < hand.length; i++) {
      const iv = hand[i].beat - hand[i-1].beat;
      if (iv > 0 && iv <= STREAM_MAX_INTERVAL) c++;
    }
    return c;
  };
  counts.n_flicks = flicks(left) + flicks(right);

  // Gallops (R-B-B or B-R-R)
  let nGallop = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = notes[i-1], b = notes[i], c = notes[i+1];
    if (c.beat - a.beat > STREAM_MAX_INTERVAL * 2) continue;
    if (a.color === c.color && a.color !== b.color) nGallop++;
  }
  counts.n_gallops = nGallop;

  // Paul
  counts.n_paul = countPaul(left) + countPaul(right);

  // Quads
  let nQuads = 0;
  for (const grp of slots.values()) {
    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      if (hand.length >= 4 && new Set(hand.map(n => n.x)).size === 4) nQuads++;
    }
  }
  counts.n_quads = nQuads;

  // Loloppes
  let nLoloppe = 0;
  for (const grp of slots.values()) {
    for (const color of [0, 1]) {
      const hd = grp.filter(n => n.color === color && n.direction !== 8);
      for (let i = 0; i < hd.length; i++) {
        for (let j = i + 1; j < hd.length; j++) {
          const a = hd[i], b = hd[j];
          if (a.direction === b.direction && Math.abs(a.x - b.x) === 1 &&
              Math.abs(a.y - b.y) <= 1) nLoloppe++;
        }
      }
    }
  }
  counts.n_loloppes = nLoloppe;

  // Handclaps
  let nHandclap = 0;
  for (const grp of slots.values()) {
    const reds  = grp.filter(n => n.color === 0 && n.direction !== 8);
    const blues = grp.filter(n => n.color === 1 && n.direction !== 8);
    outer: for (const r of reds) {
      if (RIGHT_DIRS.has(r.direction)) {
        for (const b of blues) {
          if (LEFT_DIRS.has(b.direction)) { nHandclap++; break outer; }
        }
      }
    }
  }
  counts.n_handclaps = nHandclap;

  // Windows (same-color same-lane, layer gap ≥ 2 with missing middle)
  let nWindows = 0;
  for (const grp of slots.values()) {
    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      const byLane = new Map();
      for (const n of hand) {
        if (!byLane.has(n.x)) byLane.set(n.x, []);
        byLane.get(n.x).push(n);
      }
      for (const lns of byLane.values()) {
        if (lns.length >= 2) {
          const ys = lns.map(n => n.y);
          const yMax = Math.max(...ys), yMin = Math.min(...ys);
          if (yMax - yMin >= 2 && lns.length < (yMax - yMin + 1)) nWindows++;
        }
      }
    }
  }
  counts.n_windows = nWindows;

  // Flowers (≥3 same-color same-beat, ≥2 distinct directions)
  let nFlowers = 0;
  for (const grp of slots.values()) {
    for (const color of [0, 1]) {
      const hand = grp.filter(n => n.color === color);
      if (hand.length >= 3) {
        const dirs = new Set(hand.filter(n => n.direction !== 8).map(n => n.direction));
        if (dirs.size >= 2) nFlowers++;
      }
    }
  }
  counts.n_flowers = nFlowers;

  // Hooks, scoops, shrados, arm circles, staircases
  counts.n_hooks       = countHooks(left)       + countHooks(right);
  counts.n_scoops      = countScoops(left)      + countScoops(right);
  counts.n_shrados     = countShrados(left)      + countShrados(right);
  counts.n_arm_circles = countArmCircles(left)  + countArmCircles(right);
  counts.n_staircases  = countStaircases(left)  + countStaircases(right);

  // Vision blocks (face note followed within 0.5 beats by another note)
  let nVB = 0;
  for (let i = 0; i < n; i++) {
    if (notes[i].x !== 1 && notes[i].x !== 2) continue;
    for (let j = i + 1; j < n; j++) {
      const gap = notes[j].beat - notes[i].beat;
      if (gap > 0.5) break;
      if (gap >= 0.0625) { nVB++; break; }
    }
  }
  counts.n_vision_blocks = nVB;

  // Jump stream (stream run with ≥1 same-beat double)
  let jsRuns = 0, jsNotes = 0;
  let jsRun = [notes[0]], jsHasDouble = false;
  for (let i = 1; i < n; i++) {
    const p = notes[i-1], cur = notes[i];
    const iv = cur.beat - p.beat;
    const sameSlot  = iv <= BEAT_TOL;
    const altSingle = iv > 0 && iv <= STREAM_MAX_INTERVAL && cur.color !== p.color;
    if (sameSlot || altSingle) {
      jsRun.push(cur);
      if (sameSlot && cur.color !== p.color) jsHasDouble = true;
    } else {
      if (jsRun.length >= 4 && jsHasDouble) { jsRuns++; jsNotes += jsRun.length; }
      jsRun = [cur]; jsHasDouble = false;
    }
  }
  if (jsRun.length >= 4 && jsHasDouble) { jsRuns++; jsNotes += jsRun.length; }
  counts.n_jump_stream_runs  = jsRuns;
  counts.n_jump_stream_notes = jsNotes;

  // Piano streams (monotone x in stream with alternating up/down)
  let nPiano = 0;
  let pBuf = [notes[0]];
  for (let i = 1; i < n; i++) {
    const iv = notes[i].beat - notes[i-1].beat;
    if (iv > 0 && iv <= STREAM_MAX_INTERVAL && notes[i].color !== notes[i-1].color) {
      pBuf.push(notes[i]);
    } else {
      if (pBuf.length >= 4) {
        for (let s = 0; s <= pBuf.length - 4; s++) {
          const w = pBuf.slice(s, s + 4);
          const xs = w.map(n => n.x);
          const mono = xs.every((x, k) => k === 0 || x > xs[k-1]) ||
                       xs.every((x, k) => k === 0 || x < xs[k-1]);
          if (!mono) continue;
          const nd = w.map(n => n.direction).filter(d => d !== 8);
          if (nd.length >= 3 && nd.every((d, k) =>
            k === 0 || UP_DIRS.has(nd[k]) !== UP_DIRS.has(nd[k-1])
          )) { nPiano++; break; }
        }
      }
      pBuf = [notes[i]];
    }
  }
  if (pBuf.length >= 4) {
    for (let s = 0; s <= pBuf.length - 4; s++) {
      const w = pBuf.slice(s, s + 4);
      const xs = w.map(n => n.x);
      const mono = xs.every((x, k) => k === 0 || x > xs[k-1]) ||
                   xs.every((x, k) => k === 0 || x < xs[k-1]);
      if (!mono) continue;
      const nd = w.map(n => n.direction).filter(d => d !== 8);
      if (nd.length >= 3 && nd.every((d, k) =>
        k === 0 || UP_DIRS.has(nd[k]) !== UP_DIRS.has(nd[k-1])
      )) { nPiano++; break; }
    }
  }
  counts.n_piano_streams = nPiano;

  // Croissants (4-note stream with crossing x sequences)
  let nCroissant = 0;
  for (let i = 0; i <= n - 4; i++) {
    const w = notes.slice(i, i + 4);
    if (![0,1,2].every(k => w[k].color !== w[k+1].color)) continue;
    if (![0,1,2].every(k => { const iv = w[k+1].beat - w[k].beat; return iv > 0 && iv <= STREAM_MAX_INTERVAL; })) continue;
    const c0 = w.filter(n => n.color === w[0].color).map(n => n.x);
    const c1 = w.filter(n => n.color !== w[0].color).map(n => n.x);
    if (c0.length === 2 && c1.length === 2) {
      const cross = (c0[0] > c0[1] && c1[0] < c1[1]) || (c0[0] < c0[1] && c1[0] > c1[1]);
      if (cross) nCroissant++;
    }
  }
  counts.n_croissants = nCroissant;

  // Dot spam
  counts.n_dot_spam_runs = countDotSpam(left) + countDotSpam(right);

  // Groove walls (dodge wall + note on opposite side)
  let nGroove = 0;
  for (const obs of obstacles) {
    if (obs.w > 2 || obs.duration <= 0) continue;
    const obsEnd = obs.beat + obs.duration;
    const wallNotes = notes.filter(n => n.beat >= obs.beat - 0.25 && n.beat <= obsEnd + 0.25);
    const opposite = obs.x <= 1
      ? wallNotes.filter(n => n.x >= 2)
      : wallNotes.filter(n => n.x <= 1);
    if (opposite.length) nGroove++;
  }
  counts.n_groove_walls = nGroove;

  // Bomb patterns
  if (bombs.length) {
    const bombBeats = bombs.map(b => b.beat).sort((a, b) => a - b);

    const bisectRight = (arr, val) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= val) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const bisectLeft = (arr, val) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < val) lo = mid + 1; else hi = mid; }
      return lo;
    };

    // Bomb reset
    let nBombReset = 0;
    for (const hand of [left, right]) {
      const dh = hand.filter(n => n.direction !== 8);
      for (let i = 1; i < dh.length; i++) {
        const p = dh[i-1], cur = dh[i];
        if (angleDiff(DIR_ANGLES[p.direction], DIR_ANGLES[cur.direction]) < 90) {
          const lo = bisectRight(bombBeats, p.beat + BEAT_TOL);
          const hi = bisectLeft(bombBeats, cur.beat);
          if (lo < hi) nBombReset++;
        }
      }
    }
    counts.n_bomb_resets = nBombReset;

    // Bomb hold
    const EXIT_DX = { 0: 0, 1: 0, 2: -1, 3: 1, 4: -1, 5: 1, 6: -1, 7: 1, 8: 0 };
    const EXIT_DY = { 0: 1, 1: -1, 2: 0, 3: 0, 4: 1, 5: 1, 6: -1, 7: -1, 8: 0 };
    let nBombHold = 0;
    for (const note of notes) {
      const lo = bisectRight(bombBeats, note.beat + 0.0625);
      const hi = bisectRight(bombBeats, note.beat + 1.0);
      if (hi - lo >= 3) nBombHold++;
    }
    counts.n_bomb_holds = nBombHold;

    // Hammer hits
    let nHammer = 0;
    for (const note of notes) {
      if (note.direction === 8) continue;
      const ex = note.x + EXIT_DX[note.direction];
      const ey = note.y + EXIT_DY[note.direction];
      const lo = bisectRight(bombBeats, note.beat);
      const hi = bisectRight(bombBeats, note.beat + BEAT_TOL);
      for (let k = lo; k < hi; k++) {
        if (Math.abs(bombs[k].x - ex) <= 1 && bombs[k].y === ey) { nHammer++; break; }
      }
    }
    counts.n_hammer_hits = nHammer;
  } else {
    counts.n_bomb_resets = 0;
    counts.n_bomb_holds  = 0;
    counts.n_hammer_hits = 0;
  }

  return counts;
}

// ── computeWindowedFeatures ───────────────────────────────────────────────────

function computeWindowedFeatures(notes, obstacles, bpm, windowBeats = WINDOW_BEATS) {
  const feats = {};
  if (!notes.length) return feats;

  const firstBeat = notes[0].beat;
  const lastBeat  = notes[notes.length - 1].beat;
  const duration  = Math.max(lastBeat - firstBeat, windowBeats);
  const nWindows  = Math.max(2, Math.floor(duration / windowBeats));

  const windowStats = [];

  for (let w = 0; w < nWindows; w++) {
    const wStart = firstBeat + w * windowBeats;
    const wEnd   = wStart + windowBeats;
    const wn     = notes.filter(n => n.beat >= wStart && n.beat < wEnd);
    if (!wn.length) continue;

    const nw    = wn.length;
    const leftW  = wn.filter(n => n.color === 0);
    const rightW = wn.filter(n => n.color === 1);

    // Crossover rate
    const crossovers = wn.filter(
      n => (n.color === 0 && n.x >= 2) || (n.color === 1 && n.x <= 1)
    ).length;

    // Double rate
    const slotsW = makeSlots(wn);
    const doubles = [...slotsW.values()].filter(
      g => g.some(n => n.color === 0) && g.some(n => n.color === 1)
    ).length;

    // DD rate
    const ddLeft  = ddRate(leftW);
    const ddRight = ddRate(rightW);
    const ddCombined = (ddLeft + ddRight) / 2;
    const ddDenom = wn.filter(n => n.direction !== 8).length || 1;

    // Stream rate
    let streamNotes = 0, runLen = 1;
    for (let i = 1; i < wn.length; i++) {
      const iv = wn[i].beat - wn[i-1].beat;
      if (iv > 0 && iv <= STREAM_MAX_INTERVAL && wn[i].color !== wn[i-1].color) runLen++;
      else { if (runLen >= 4) streamNotes += runLen; runLen = 1; }
    }
    if (runLen >= 4) streamNotes += runLen;

    // Vibro rate
    let vibroNotes = 0;
    for (let i = 1; i < wn.length; i++) {
      const iv = wn[i].beat - wn[i-1].beat;
      if (iv > 0 && iv <= VIBRO_MAX_INTERVAL && wn[i].color !== wn[i-1].color) vibroNotes++;
    }

    // Peak eBPM
    const peakEbpm = Math.max(
      ebpmStats(leftW, bpm).max,
      ebpmStats(rightW, bpm).max
    );

    // Jump rate
    const jumps = countJumps(leftW) + countJumps(rightW);

    // Loloppe rate
    let loloppes = 0;
    for (const grp of slotsW.values()) {
      for (const color of [0, 1]) {
        const hd = grp.filter(n => n.color === color && n.direction !== 8);
        for (let i = 0; i < hd.length; i++) {
          for (let j = i + 1; j < hd.length; j++) {
            const a = hd[i], b = hd[j];
            if (a.direction === b.direction && Math.abs(a.x - b.x) === 1 &&
                Math.abs(a.y - b.y) <= 1) loloppes++;
          }
        }
      }
    }

    // Top row rate
    const topRow = wn.filter(n => n.y === 2).length;

    // Hand imbalance
    const handImbalance = Math.abs(leftW.length - rightW.length) / nw;

    // Wall density
    const wWalls = obstacles
      ? obstacles.filter(o => o.beat >= wStart && o.beat < wEnd).length
      : 0;

    // Recompute dd_rate using the combined metric (matching Python)
    const ddDirNotes = wn.filter(n => n.direction !== 8).length;
    let ddBreaks = 0;
    for (const hand of [leftW, rightW]) {
      const dh = hand.filter(n => n.direction !== 8);
      for (let i = 1; i < dh.length; i++) {
        if (angleDiff(DIR_ANGLES[dh[i-1].direction], DIR_ANGLES[dh[i].direction]) < 90) ddBreaks++;
      }
    }

    windowStats.push({
      note_density:   nw / windowBeats,
      crossover_rate: crossovers / nw,
      double_rate:    doubles / nw,
      dd_rate:        ddDirNotes > 0 ? ddBreaks / ddDirNotes : 0,
      stream_rate:    streamNotes / nw,
      vibro_rate:     vibroNotes / nw,
      peak_ebpm:      peakEbpm,
      jump_rate:      jumps / nw,
      loloppe_rate:   loloppes / nw,
      top_row_rate:   topRow / nw,
      hand_imbalance: handImbalance,
      wall_density:   wWalls / windowBeats,
    });
  }

  if (!windowStats.length) return feats;

  // Note: n_windows is NOT in the 202-feature list (it's overwritten by n_windows
  // pattern count from count_patterns, which then gets overwritten here).
  // We output it so the caller can use it, but it maps to the same key as the
  // window pattern count — matching the Python training data behaviour.
  feats.n_windows = windowStats.length;

  const metrics = Object.keys(windowStats[0]);
  for (const metric of metrics) {
    const vals = windowStats.map(w => w[metric]);
    const pfx  = `win_${metric}`;
    feats[`${pfx}_max`]        = Math.max(...vals);
    feats[`${pfx}_mean`]       = mean(vals);
    feats[`${pfx}_std`]        = std(vals);
    feats[`${pfx}_p90`]        = percentile(vals, 90);
    feats[`${pfx}_p10`]        = percentile(vals, 10);
    const mv = feats[`${pfx}_mean`];
    feats[`${pfx}_peak_ratio`] = mv > 0 ? feats[`${pfx}_max`] / mv : 1.0;
  }

  return feats;
}

// ── computeFeatures — main entry point ────────────────────────────────────────

/**
 * Compute all 202 pattern features from parsed beatmap data.
 *
 * @param {Note[]}     notes     - sorted by beat
 * @param {Obstacle[]} obstacles
 * @param {object[]}   arcs      - raw arc JSON objects
 * @param {object[]}   chains    - raw chain JSON objects
 * @param {number}     bpm
 * @param {Note[]}     bombs     - optional
 * @returns {Object}  map of feature name → float value
 */
function computeFeatures(notes, obstacles = [], arcs = [], chains = [], bpm = 120, bombs = []) {
  const feats = {};
  const n = notes.length;
  if (!n) return feats;

  const notesSorted = [...notes].sort((a, b) => a.beat - b.beat);
  const firstBeat   = notesSorted[0].beat;
  const lastBeat    = notesSorted[n - 1].beat;
  const mapDuration = Math.max(lastBeat - firstBeat, 1.0);

  const left  = notesSorted.filter(n => n.color === 0);
  const right = notesSorted.filter(n => n.color === 1);

  // Lane histograms
  for (let i = 0; i < 4; i++)
    feats[`lane_${i}_rate`] = notesSorted.filter(n => n.x === i).length / n;

  // Layer histograms
  for (let i = 0; i < 3; i++)
    feats[`layer_${i}_rate`] = notesSorted.filter(n => n.y === i).length / n;
  feats.top_row_rate = feats.layer_2_rate;

  // Direction histogram
  for (let i = 0; i < 9; i++)
    feats[`dir_${i}_rate`] = notesSorted.filter(n => n.direction === i).length / n;
  feats.dot_note_rate = feats.dir_8_rate;

  // Hand balance
  feats.left_note_rate = left.length / n;
  feats.hand_imbalance = Math.abs(left.length - right.length) / n;

  // Double rate (1/8-beat slots)
  const slots8 = makeSlots(notesSorted);
  const doubleSlots = [...slots8.values()].filter(
    g => g.some(n => n.color === 0) && g.some(n => n.color === 1)
  ).length;
  feats.double_rate = slots8.size ? doubleSlots / slots8.size : 0;

  // Crossover rate
  feats.crossover_rate = notesSorted.filter(
    n => (n.color === 0 && n.x >= 2) || (n.color === 1 && n.x <= 1)
  ).length / n;

  // DD rates
  feats.dd_rate_left  = ddRate(left);
  feats.dd_rate_right = ddRate(right);
  feats.dd_rate_total = (feats.dd_rate_left + feats.dd_rate_right) / 2;

  // eBPM
  const leftEbpm  = ebpmStats(left,  bpm);
  const rightEbpm = ebpmStats(right, bpm);
  for (const [stat, val] of Object.entries(leftEbpm))
    feats[`ebpm_left_${stat}`] = val;
  for (const [stat, val] of Object.entries(rightEbpm))
    feats[`ebpm_right_${stat}`] = val;
  feats.ebpm_max_overall = Math.max(leftEbpm.max, rightEbpm.max);
  feats.ebpm_p90_overall = Math.max(leftEbpm.p90, rightEbpm.p90);

  // Timing CV
  feats.interval_cv_left  = intervalCV(left);
  feats.interval_cv_right = intervalCV(right);

  // Rotation
  feats.rotation_mean_left  = meanRotation(left);
  feats.rotation_mean_right = meanRotation(right);
  feats.rotation_mean_total = (feats.rotation_mean_left + feats.rotation_mean_right) / 2;

  // Arcs and chains
  feats.arc_count   = (arcs   || []).length;
  feats.chain_count = (chains || []).length;
  feats.arc_rate    = feats.arc_count   / n;
  feats.chain_rate  = feats.chain_count / n;

  // Obstacles
  const dodgeWalls  = (obstacles || []).filter(isDodge);
  const crouchWalls = (obstacles || []).filter(isCrouch);
  feats.dodge_wall_count  = dodgeWalls.length;
  feats.crouch_wall_count = crouchWalls.length;
  feats.total_wall_count  = (obstacles || []).length;
  feats.dodge_wall_rate   = dodgeWalls.length  / mapDuration;
  feats.crouch_wall_rate  = crouchWalls.length / mapDuration;
  feats.wall_density      = (obstacles || []).length / mapDuration;

  // Map duration and density
  feats.map_duration_beats = mapDuration;
  feats.note_density       = n / mapDuration;

  // Named pattern counts
  const patterns = countPatterns(notesSorted, bpm, obstacles || [], bombs || []);
  Object.assign(feats, patterns);

  // Derived pattern rates (must be computed BEFORE windowed features overwrite n_windows)
  const RATE_KEYS = [
    'n_doubles','n_scissor','n_stacks','n_towers','n_face_notes',
    'n_crossovers','n_crossover_scissor','n_inline','n_dd',
    'n_triangles','n_jumps','n_inverts','n_stream_notes',
    'n_vibro_notes','n_flicks','n_gallops','n_paul','n_quads',
    'n_loloppes','n_handclaps','n_windows','n_flowers',
    'n_hooks','n_scoops','n_shrados','n_arm_circles','n_staircases',
    'n_vision_blocks','n_jump_stream_notes','n_piano_streams',
    'n_croissants','n_dot_spam_runs','n_groove_walls',
    'n_bomb_resets','n_bomb_holds','n_hammer_hits',
  ];
  for (const key of RATE_KEYS) {
    if (key in feats) feats[`${key}_rate`] = feats[key] / n;
  }

  // Windowed features (n_windows gets overwritten here — mirrors Python)
  Object.assign(feats, computeWindowedFeatures(notesSorted, obstacles, bpm));

  // n_notes_parsed
  feats.n_notes_parsed = n;

  // Sanitise: replace NaN/Infinity with 0
  for (const k of Object.keys(feats)) {
    if (!isFinite(feats[k])) feats[k] = 0;
  }

  return feats;
}

/**
 * Produce a Float32Array in the exact feature order from pattern_classifier_meta.json.
 *
 * @param {Object}   featureMap   - output of computeFeatures()
 * @param {string[]} featureNames - meta.features array
 * @returns {Float32Array}
 */
function toFeatureVector(featureMap, featureNames) {
  const vec = new Float32Array(featureNames.length);
  for (let i = 0; i < featureNames.length; i++) {
    const v = featureMap[featureNames[i]];
    vec[i] = (v === undefined || !isFinite(v)) ? 0.0 : v;
  }
  return vec;
}

export { computeFeatures, toFeatureVector, computeWindowedFeatures, countPatterns };
