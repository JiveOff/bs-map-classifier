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
import { parseBeatmap, findDatFilename } from '../src/parser.js';
import { annotatePatterns } from '../src/patterns.js';

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

    // Locate the .dat file
    const infoDat  = findInfoDat(mapDir);
    const datName  = infoDat ? findDatFilename(infoDat, characteristic, difficulty)
                             : `${difficulty}${characteristic}.dat`;
    const datPath  = path.join(mapDir, datName);

    if (!fs.existsSync(datPath)) { skipped++; continue; }

    try {
      const raw     = readJson(datPath);
      const parsed  = parseBeatmap(raw);
      const meta    = { id: key, category };
      const result  = annotatePatterns(
        parsed.notes, bpm, meta, parsed.obstacles, parsed.bombs
      );

      const counts = aggregateCounts(result.patterns);
      results.push({
        map_key:   key,
        category,
        n_notes:   parsed.notes.length,
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
