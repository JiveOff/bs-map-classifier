#!/usr/bin/env node
/**
 * annotate_batch.js
 *
 * Walks data/raw/maps/<category>/<key>/, runs the JS parser + pattern annotator
 * on each map, aggregates per-type pattern counts, and writes JSON to stdout
 * (or --output <file>).
 *
 * Output: JSON array of objects, one per map:
 *   { map_key, category, n_notes, ...pattern_count_fields }
 *
 * Usage:
 *   node js/lib/scripts/annotate_batch.js --maps data/raw/maps
 *   node js/lib/scripts/annotate_batch.js --maps data/raw/maps --output data/processed/js_pattern_counts.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseBeatmap, findDatInfo } from '../src/parser.js';
import { annotatePatterns } from '../src/patterns.js';
import { NoteJumpSpeed } from 'bsmap';
import { count as swingCount } from 'bsmap/extensions/swing';

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mapsDir = 'data/raw/maps';
let outputFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--maps' && args[i + 1]) mapsDir = args[++i];
  if (args[i] === '--output' && args[i + 1]) outputFile = args[++i];
}

// Resolve relative to cwd
mapsDir = path.resolve(mapsDir);

// ── Helpers ────────────────────────────────────────────────────────────────

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findInfoDat(mapDir) {
  for (const name of ['Info.dat', 'info.dat', 'Info.json']) {
    const p = path.join(mapDir, name);
    if (fs.existsSync(p)) return readJson(p);
  }
  return null;
}

/**
 * Aggregate annotatePatterns() output into a flat count object.
 * Each pattern type → how many times it occurred.
 */
function aggregateCounts(patterns) {
  const counts = {};
  for (const ev of patterns) {
    const k = `n_${ev.type}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// ── NPS / SPS helpers (mirrors features.js for training/inference parity) ──

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function calcMaxRollingSps(arr, win) {
  if (!arr.length) return 0;
  if (arr.length <= win) return arr.reduce((a, b) => a + b, 0) / arr.length;
  let cur = arr.slice(0, win).reduce((a, b) => a + b, 0), max = cur;
  for (let i = 0; i < arr.length - win; i++) {
    cur = cur - arr[i] + arr[i + win];
    if (cur > max) max = cur;
  }
  return max / win;
}

function computeNpsSps(notes, bpm) {
  if (notes.length < 2) return {};
  const secPerBeat = 60 / bpm;
  const firstBeat  = notes[0].beat;
  const lastBeat   = notes[notes.length - 1].beat;
  const durSec     = Math.max((lastBeat - firstBeat) * secPerBeat, 0.001);

  // NPS mapped
  const nps_mapped = notes.length / durSec;

  // Peak NPS at 4/8/16 beat windows (sliding window)
  function peakNPS(windowBeats) {
    const wSec = windowBeats * secPerBeat;
    let max = 0, lo = 0;
    for (let hi = 0; hi < notes.length; hi++) {
      const tHi = notes[hi].beat * secPerBeat;
      while ((tHi - notes[lo].beat * secPerBeat) > wSec) lo++;
      const span = Math.max(tHi - notes[lo].beat * secPerBeat, wSec);
      max = Math.max(max, (hi - lo + 1) / span);
    }
    return max;
  }

  // SPS via bsmap canonical algorithm
  const timeProc = {
    bpm,
    toRealTime:  beat    => beat * secPerBeat,
    toBeatTime:  seconds => seconds / secPerBeat,
  };
  const bsmapNotes = notes.map(n => ({
    time: n.beat, posX: n.x, posY: n.y, color: n.color, direction: n.direction,
  }));
  const durTotal = lastBeat * secPerBeat + 1;
  const swing    = swingCount(bsmapNotes, durTotal, timeProc);
  const total    = swing.left.map((v, i) => v + swing.right[i]);

  function spsStats(arr) {
    const nonZero = arr.filter(v => v > 0);
    return {
      avg:    arr.reduce((a, b) => a + b, 0) / durSec,
      median: median(nonZero),
      peak:   calcMaxRollingSps(arr, 10),
    };
  }
  const t = spsStats(total), r = spsStats(swing.left), b = spsStats(swing.right);

  return {
    nps_mapped,
    peak_nps_4beat:  peakNPS(4),
    peak_nps_8beat:  peakNPS(8),
    peak_nps_16beat: peakNPS(16),
    sps_total_avg: t.avg, sps_total_median: t.median, sps_total_peak: t.peak,
    sps_red_avg:   r.avg, sps_red_median:   r.median, sps_red_peak:   r.peak,
    sps_blue_avg:  b.avg, sps_blue_median:  b.median, sps_blue_peak:  b.peak,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

const results = [];
let ok = 0, skipped = 0, failed = 0;

for (const category of fs.readdirSync(mapsDir).sort()) {
  const catDir = path.join(mapsDir, category);
  if (!fs.statSync(catDir).isDirectory()) continue;

  for (const key of fs.readdirSync(catDir).sort()) {
    const mapDir = path.join(catDir, key);
    if (!fs.statSync(mapDir).isDirectory()) continue;

    const datasetPath = path.join(mapDir, '_dataset.json');
    if (!fs.existsSync(datasetPath)) { skipped++; continue; }

    let dataset;
    try { dataset = readJson(datasetPath); }
    catch { skipped++; continue; }

    const characteristic = dataset.characteristic || 'Standard';
    const difficulty     = dataset.difficulty     || 'ExpertPlus';
    const bpm            = parseFloat(dataset.bpm) || 120;

    // Locate the .dat file and read NJS / offset
    const infoDat  = findInfoDat(mapDir);
    const datInfo  = infoDat
      ? findDatInfo(infoDat, characteristic, difficulty)
      : { filename: `${difficulty}${characteristic}.dat`, njs: 0, njsOffset: 0 };
    const datPath  = path.join(mapDir, datInfo.filename);

    if (!fs.existsSync(datPath)) { skipped++; continue; }

    try {
      const raw     = readJson(datPath);
      const parsed  = parseBeatmap(raw);
      const meta    = { id: key, category };
      const result  = annotatePatterns(
        parsed.notes, bpm, meta, parsed.obstacles, parsed.bombs
      );

      const effectiveNjs = datInfo.njs > 0 ? datInfo.njs : 10;
      const njsObj       = new NoteJumpSpeed(bpm, effectiveNjs, datInfo.njsOffset);
      const [jdLow, jdHigh] = njsObj.calcJdOptimal();

      const counts    = aggregateCounts(result.patterns);
      const npsSps    = parsed.notes.length >= 2
        ? computeNpsSps(
            [...parsed.notes].sort((a, b) => a.beat - b.beat),
            bpm
          )
        : {};
      results.push({
        map_key:          key,
        category,
        n_notes:          parsed.notes.length,
        njs:              effectiveNjs,
        njs_offset:       datInfo.njsOffset,
        jump_distance:    njsObj.jd,
        reaction_time:    njsObj.reactionTime,
        hjd:              njsObj.hjd,
        jd_optimal_low:   jdLow,
        jd_optimal_high:  jdHigh,
        jd_delta_low:     njsObj.jd - jdLow,
        jd_delta_high:    njsObj.jd - jdHigh,
        ...npsSps,
        ...counts,
      });
      ok++;
    } catch (e) {
      process.stderr.write(`FAILED ${key}: ${e.message}\n`);
      failed++;
    }
  }
}

process.stderr.write(`Done: ${ok} ok, ${skipped} skipped, ${failed} failed\n`);

const json = JSON.stringify(results, null, 2);
if (outputFile) {
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outputFile), json, 'utf8');
  process.stderr.write(`Wrote ${results.length} records to ${outputFile}\n`);
} else {
  process.stdout.write(json + '\n');
}
