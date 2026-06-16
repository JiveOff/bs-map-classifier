/**
 * classify-from-beatsaver.js
 *
 * Fetches a map from BeatSaver by its short key, picks the hardest available
 * difficulty, classifies it, and prints the result.
 *
 * Usage:
 *   node examples/classify-from-beatsaver.js <map-key> [characteristic] [difficulty]
 *
 * Examples:
 *   node examples/classify-from-beatsaver.js 2b120
 *   node examples/classify-from-beatsaver.js 2b120 Standard ExpertPlus
 *
 * Requirements:
 *   npm install bs-map-classifier onnxruntime-node fflate
 */

import { createWriteStream } from 'node:fs';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';

import {
  loadClassifier,
  parseBeatmap,
  findDatFilename,
  parseMap,
} from 'bs-map-classifier';

// ── Config ────────────────────────────────────────────────────────────────────

const MODEL_PATH = new URL('../models/pattern_classifier.onnx', import.meta.url).pathname;
const META_PATH  = new URL('../models/pattern_classifier_meta.json', import.meta.url).pathname;

const BEATSAVER_API = 'https://beatsaver.com/api/maps/id';
const CDN_BASE      = 'https://cdn.beatsaver.com';

// Difficulty ranking — used to pick the hardest when none is specified
const DIFF_RANK = { ExpertPlus: 5, Expert: 4, Hard: 3, Normal: 2, Easy: 1 };

// ── BeatSaver helpers ─────────────────────────────────────────────────────────

async function fetchMapInfo(key) {
  const res = await fetch(`${BEATSAVER_API}/${key}`);
  if (!res.ok) throw new Error(`BeatSaver API error ${res.status} for key "${key}"`);
  return res.json();
}

async function downloadZip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function pickDifficulty(mapInfo, wantChar, wantDiff) {
  // Collect all versions → diffs
  const candidates = [];
  for (const version of mapInfo.versions ?? []) {
    for (const diff of version.diffs ?? []) {
      if (wantChar && diff.characteristic !== wantChar) continue;
      if (wantDiff && diff.difficulty     !== wantDiff) continue;
      candidates.push({ ...diff, downloadURL: version.downloadURL, hash: version.hash });
    }
  }
  if (!candidates.length) {
    throw new Error(
      `No matching difficulty found. ` +
      `Requested: ${wantChar ?? 'any'}/${wantDiff ?? 'any'}`
    );
  }
  // Pick hardest available
  candidates.sort((a, b) => (DIFF_RANK[b.difficulty] ?? 0) - (DIFF_RANK[a.difficulty] ?? 0));
  return candidates[0];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [,, key, wantChar = null, wantDiff = null] = process.argv;
  if (!key) {
    console.error('Usage: node classify-from-beatsaver.js <map-key> [characteristic] [difficulty]');
    process.exit(1);
  }

  // 1. Load classifier
  console.log('Loading classifier…');
  const classifier = await loadClassifier(MODEL_PATH, META_PATH);

  // 2. Fetch map metadata from BeatSaver
  console.log(`Fetching map info for key "${key}"…`);
  const mapInfo = await fetchMapInfo(key);
  console.log(`  "${mapInfo.metadata?.songName}" by ${mapInfo.metadata?.songAuthorName}`);
  console.log(`  Mapped by: ${mapInfo.metadata?.levelAuthorName}`);

  // 3. Pick difficulty
  const chosen = pickDifficulty(mapInfo, wantChar, wantDiff);
  console.log(`  Chosen difficulty: ${chosen.characteristic} / ${chosen.difficulty}`);

  const bpm = mapInfo.metadata?.bpm ?? 120;

  // 4. Download zip
  console.log(`Downloading zip from ${CDN_BASE}/${chosen.hash}.zip …`);
  const zipBuffer = await downloadZip(`${CDN_BASE}/${chosen.hash}.zip`);

  // 5. Unzip in memory with fflate
  const files = unzipSync(new Uint8Array(zipBuffer));
  const fileMap = Object.fromEntries(
    Object.entries(files).map(([name, buf]) => [name.toLowerCase(), { name, buf }])
  );

  // 6. Find and parse Info.dat
  const infoEntry = fileMap['info.dat'] ?? fileMap['info.dat'.replace('.', '.')];
  if (!infoEntry) throw new Error('Info.dat not found in zip');
  const infoDat = JSON.parse(Buffer.from(infoEntry.buf).toString('utf8'));

  // 7. Find the correct difficulty .dat
  const datFilename = findDatFilename(infoDat, chosen.characteristic, chosen.difficulty);
  const datEntry    = fileMap[datFilename.toLowerCase()];
  if (!datEntry) throw new Error(`Difficulty file "${datFilename}" not found in zip`);
  const datJson = JSON.parse(Buffer.from(datEntry.buf).toString('utf8'));

  // 8. Parse beatmap
  const beatmap = parseBeatmap(datJson);
  console.log(`  Notes: ${beatmap.notes.length}  Obstacles: ${beatmap.obstacles.length}  Arcs: ${beatmap.arcs.length}  Chains: ${beatmap.chains.length}`);

  // 9. Classify
  console.log('Classifying…');
  const result = await parseMap(beatmap, bpm, classifier);
  const { category, confidence, probabilities } = result.classification;

  // 10. Print results
  console.log('\n── Classification ───────────────────────────────────');
  console.log(`  Category   : ${category}`);
  console.log(`  Confidence : ${(confidence * 100).toFixed(1)}%`);
  console.log('\n  Probabilities:');
  for (const [cls, prob] of Object.entries(probabilities).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round(prob * 20)).padEnd(20, '░');
    console.log(`    ${cls.padEnd(10)} ${bar}  ${(prob * 100).toFixed(1)}%`);
  }

  console.log('\n── Top patterns ─────────────────────────────────────');
  const counts = {};
  for (const p of result.patterns) counts[p.type] = (counts[p.type] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [type, count] of sorted) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
