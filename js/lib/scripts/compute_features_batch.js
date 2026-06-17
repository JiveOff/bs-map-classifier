#!/usr/bin/env node
/**
 * compute_features_batch.js
 *
 * Runs computeFeatures() from features.js on every downloaded map and writes
 * one JSON record per map to stdout (or --output <file>).
 *
 * This produces the EXACT feature vector that the ONNX inference pipeline will
 * compute at runtime, guaranteeing training/inference feature parity.
 *
 * Usage:
 *   node js/lib/scripts/compute_features_batch.js --maps data/raw/maps
 *   node js/lib/scripts/compute_features_batch.js --maps data/raw/maps --output data/processed/js_features.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseBeatmap, findDatInfo } from '../src/parser.js';
import { computeFeatures } from '../src/features.js';

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let mapsDir    = 'data/raw/maps';
let outputFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--maps'   && args[i + 1]) mapsDir    = args[++i];
  if (args[i] === '--output' && args[i + 1]) outputFile = args[++i];
}

mapsDir = path.resolve(mapsDir);

// ── Helpers ────────────────────────────────────────────────────────────────
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function findInfoDat(mapDir) {
  for (const name of ['Info.dat', 'info.dat', 'Info.json']) {
    const p = path.join(mapDir, name);
    if (fs.existsSync(p)) return readJson(p);
  }
  return null;
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

    const infoDat  = findInfoDat(mapDir);
    const datInfo  = infoDat
      ? findDatInfo(infoDat, characteristic, difficulty)
      : { filename: `${difficulty}${characteristic}.dat`, njs: 0, njsOffset: 0 };
    const datPath  = path.join(mapDir, datInfo.filename);
    if (!fs.existsSync(datPath)) { skipped++; continue; }

    try {
      const raw    = readJson(datPath);
      const parsed = parseBeatmap(raw);
      const feats  = computeFeatures(
        parsed.notes, parsed.obstacles, parsed.arcs, parsed.chains,
        bpm, parsed.bombs, datInfo.njs, datInfo.njsOffset
      );
      results.push({ map_key: key, category, ...feats });
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
