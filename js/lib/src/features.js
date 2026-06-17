'use strict';
import { annotatePatterns } from './patterns.js';
import { NoteJumpSpeed } from 'bsmap';
import { count as swingCount } from 'bsmap/extensions/swing';
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

// ── Jump count helper (also used in computeWindowedFeatures) ─────────────────

function countJumps(hand, maxBeats = 2) {
  let c = 0;
  for (let i = 1; i < hand.length; i++) {
    if (hand[i].beat - hand[i-1].beat > maxBeats) continue;
    const dx = hand[i].x - hand[i-1].x, dy = hand[i].y - hand[i-1].y;
    if (Math.sqrt(dx*dx + dy*dy) >= 2) c++;
  }
  return c;
}

// ── SPS (Swings Per Second) via bsmap ────────────────────────────────────────
// Adapts our note format ({beat,x,y,color,direction}) to bsmap's expected
// shape ({time,posX,posY,color,direction}) and builds a minimal TimeProcessor
// for constant-BPM maps.

function computeSPS(notes, bpm) {
  if (!notes.length) return { total: {}, red: {}, blue: {} };

  const secPerBeat = 60 / bpm;
  const timeProc = {
    bpm,
    toRealTime:  beat    => beat * secPerBeat,
    toBeatTime:  seconds => seconds / secPerBeat,
  };

  // Map our note format to bsmap's expected properties
  const bsmapNotes = notes.map(n => ({
    time:      n.beat,
    posX:      n.x,
    posY:      n.y,
    color:     n.color,
    direction: n.direction,
  }));

  const lastNote   = bsmapNotes[bsmapNotes.length - 1];
  const firstNote  = bsmapNotes[0];
  const duration   = timeProc.toRealTime(lastNote.time) + 1;  // +1 so last second bin exists

  const swing = swingCount(bsmapNotes, duration, timeProc);
  const swingTotal = swing.left.map((v, i) => v + swing.right[i]);

  function spsStats(arr) {
    const nonZero = arr.filter(v => v > 0);
    if (!nonZero.length) return { avg: 0, median: 0, peak: 0, total: 0 };
    const mapDurSec = timeProc.toRealTime(lastNote.time - firstNote.time) || 1;
    return {
      avg:    arr.reduce((a, b) => a + b, 0) / mapDurSec,
      median: median(nonZero),
      peak:   calcMaxRollingSps(arr, 10),
      total:  arr.reduce((a, b) => a + b, 0),
    };
  }

  return {
    total: spsStats(swingTotal),
    red:   spsStats(swing.left),
    blue:  spsStats(swing.right),
  };
}

function calcMaxRollingSps(arr, window) {
  if (!arr.length) return 0;
  if (arr.length <= window) return arr.reduce((a, b) => a + b, 0) / arr.length;
  let cur = arr.slice(0, window).reduce((a, b) => a + b, 0);
  let max = cur;
  for (let i = 0; i < arr.length - window; i++) {
    cur = cur - arr[i] + arr[i + window];
    if (cur > max) max = cur;
  }
  return max / window;
}

// ── Peak NPS at multiple window sizes ────────────────────────────────────────

function peakNPS(notes, bpm, windowBeats) {
  if (notes.length < 2) return 0;
  const secPerBeat = 60 / bpm;
  const windowSec  = windowBeats * secPerBeat;
  let maxNps = 0;
  let lo = 0;
  for (let hi = 0; hi < notes.length; hi++) {
    const tHi = notes[hi].beat * secPerBeat;
    while ((tHi - notes[lo].beat * secPerBeat) > windowSec) lo++;
    const count = hi - lo + 1;
    const span  = Math.max(tHi - notes[lo].beat * secPerBeat, windowSec);
    maxNps = Math.max(maxNps, count / span);
  }
  return maxNps;
}

// ── aggregatePatterns — uses patterns.js (single source of truth) ────────────
// Maps annotatePatterns() event stream → named count object, keeping the same
// feature names as the old countPatterns() for backward compatibility.

function aggregatePatterns(notes, bpm, obstacles = [], bombs = []) {
  if (!notes.length) return {};

  // Run the canonical annotator (patterns.js) — single source of truth
  const { patterns: events } = annotatePatterns(notes, bpm, {}, obstacles, bombs);

  // Count events by type
  const tc = {};
  for (const ev of events) tc[ev.type] = (tc[ev.type] || 0) + 1;

  const streamEvs     = events.filter(e => e.type === 'stream');
  const vibroEvs      = events.filter(e => e.type === 'vibro_stream');
  const jsEvs         = events.filter(e => e.type === 'jump_stream');

  return {
    // Slot-based
    n_doubles:           tc.double            || 0,
    n_scissor:           tc.scissor           || 0,
    n_stacks:            tc.stack             || 0,
    n_towers:            tc.tower             || 0,
    n_loloppes:          tc.loloppe           || 0,
    n_handclaps:         tc.handclap          || 0,
    n_windows:           tc.window            || 0,
    n_crossover_scissor: tc.crossover_scissor || 0,
    // Per-note (n_face_notes omitted — equals lane_1_rate + lane_2_rate, computable from existing)
    n_dot_notes:         tc.dot_note          || 0,
    n_top_row_notes:     tc.top_row_note      || 0,
    n_crossovers:        tc.crossover         || 0,
    n_inverts:           tc.invert            || 0,
    n_vision_blocks:     tc.vision_block      || 0,
    // Sequential per-hand
    n_dd:                tc.dd                || 0,
    n_jumps:             tc.jump              || 0,
    n_inline:            tc.inline            || 0,
    n_flicks:            tc.flick             || 0,
    n_triangles:         tc.triangle          || 0,
    n_hooks:             tc.hook              || 0,
    n_scoops:            tc.scoop             || 0,
    n_shrados:           tc.shrado            || 0,
    n_staircases:        tc.staircase         || 0,
    n_gallops:           tc.gallop            || 0,
    // Obstacle
    n_groove_walls:      tc.groove_wall       || 0,
    // Bomb
    n_bomb_resets:       tc.bomb_reset        || 0,
    // Stream family (extract note counts from event notes arrays)
    n_stream_runs:       streamEvs.length,
    n_stream_notes:      streamEvs.reduce((s, e) => s + e.notes.length, 0),
    longest_stream:      streamEvs.reduce((m, e) => Math.max(m, e.notes.length), 0),
    n_vibro_notes:       vibroEvs.reduce((s, e) => s + e.notes.length, 0),
    n_jump_stream_runs:  jsEvs.length,
    n_jump_stream_notes: jsEvs.reduce((s, e) => s + e.notes.length, 0),
  };
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
    // p10 omitted — near-zero importance across all windowed metrics
    const mv = feats[`${pfx}_mean`];
    feats[`${pfx}_peak_ratio`] = mv > 0 ? feats[`${pfx}_max`] / mv : 1.0;
  }

  return feats;
}

// ── computeFeatures — main entry point ────────────────────────────────────────

/**
 * Compute pattern features from parsed beatmap data.
 *
 * @param {Note[]}     notes     - sorted by beat
 * @param {Obstacle[]} obstacles
 * @param {object[]}   arcs      - raw arc JSON objects
 * @param {object[]}   chains    - raw chain JSON objects
 * @param {number}     bpm
 * @param {Note[]}     bombs     - optional
 * @returns {Object}  map of feature name → float value
 */
function computeFeatures(notes, obstacles = [], arcs = [], chains = [], bpm = 120, bombs = [], njs = 0, njsOffset = 0) {
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

  // Direction histogram
  for (let i = 0; i < 9; i++)
    feats[`dir_${i}_rate`] = notesSorted.filter(n => n.direction === i).length / n;

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
  // rotation_mean_total omitted — (left+right)/2, redundant given both halves

  // Arcs (chains excluded — near-zero importance)
  feats.arc_count = (arcs || []).length;
  feats.arc_rate  = feats.arc_count / n;

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

  // True NPS (notes per second) — distinct from note_density which is per beat
  const secPerBeat      = 60 / bpm;
  const mapDurationSec  = Math.max(mapDuration * secPerBeat, 0.001);
  feats.nps_mapped      = n / mapDurationSec;
  feats.peak_nps_4beat  = peakNPS(notesSorted, bpm, 4);
  feats.peak_nps_8beat  = peakNPS(notesSorted, bpm, 8);
  feats.peak_nps_16beat = peakNPS(notesSorted, bpm, 16);

  // SPS (Swings Per Second) — canonical Beat Games / ScoreSaber algorithm via bsmap
  {
    const sps = computeSPS(notesSorted, bpm);
    feats.sps_total_avg    = sps.total.avg;
    feats.sps_total_median = sps.total.median;
    feats.sps_total_peak   = sps.total.peak;
    feats.sps_red_avg      = sps.red.avg;
    feats.sps_red_median   = sps.red.median;
    feats.sps_red_peak     = sps.red.peak;
    feats.sps_blue_avg     = sps.blue.avg;
    feats.sps_blue_median  = sps.blue.median;
    feats.sps_blue_peak    = sps.blue.peak;
  }

  // Named pattern counts — via patterns.js (single source of truth)
  const patternCounts = aggregatePatterns(notesSorted, bpm, obstacles || [], bombs || []);
  Object.assign(feats, patternCounts);

  // Derived rates — excluded:
  //   n_crossovers_rate  = crossover_rate (already computed above)
  //   n_dd_rate          = redundant with dd_rate_total (different denominator, same signal)
  //   n_face_notes_rate  = lane_1_rate + lane_2_rate (computable from existing features)
  const RATE_KEYS = [
    'n_doubles', 'n_scissor', 'n_stacks', 'n_towers',
    'n_crossover_scissor',
    'n_inline', 'n_triangles', 'n_jumps', 'n_inverts',
    // n_dd count kept below but n_dd_rate excluded (redundant with dd_rate_total)
    'n_stream_notes', 'n_vibro_notes', 'n_flicks', 'n_gallops',
    'n_loloppes', 'n_handclaps', 'n_windows',
    'n_hooks', 'n_scoops', 'n_shrados', 'n_staircases',
    'n_vision_blocks', 'n_jump_stream_notes', 'n_groove_walls',
    'n_bomb_resets',
  ];
  for (const key of RATE_KEYS) {
    if (key in feats) feats[`${key}_rate`] = feats[key] / n;
  }

  // NJS / jump distance / reaction time
  // Use bsmap's NoteJumpSpeed which replicates Beat Games' HJD algorithm exactly.
  // Falls back to difficulty-based defaults when njs is absent from Info.dat.
  {
    const effectiveNjs = njs > 0 ? njs : 10;
    const njsObj = new NoteJumpSpeed(bpm, effectiveNjs, njsOffset);
    feats.njs            = effectiveNjs;
    feats.njs_offset     = njsOffset;
    feats.jump_distance  = njsObj.jd;
    feats.reaction_time  = njsObj.reactionTime;   // seconds
    feats.hjd            = njsObj.hjd;            // beats
    const [jdLow, jdHigh] = njsObj.calcJdOptimal();
    feats.jd_optimal_low  = jdLow;
    feats.jd_optimal_high = jdHigh;
    feats.jd_delta_low    = feats.jump_distance - jdLow;   // negative = too short
    feats.jd_delta_high   = feats.jump_distance - jdHigh;  // positive = too long
  }

  // n_notes_parsed (metadata only — not a training feature)
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

export { computeFeatures, toFeatureVector };
