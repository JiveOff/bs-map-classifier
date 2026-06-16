/**
 * verify_parity.js — cross-check JS vs Python feature computation.
 *
 * Usage:
 *   node verify_parity.js               # uses bundled test data
 *   node verify_parity.js <map_dir>     # path to extracted map directory
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseBeatmap, findDatFilename } from './src/parser.js';
import { computeFeatures, toFeatureVector } from './src/features.js';
import { loadClassifier, classifyFromNotes } from './src/classify.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Load Python reference features ───────────────────────────────────────────

async function loadPythonRef(mapKey, category) {
  // Read from pattern_features.csv
  const csv = await readFile(join(ROOT, 'data/processed/pattern_features.csv'), 'utf8');
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => row[h] = cols[i]);
    if (row.map_key === mapKey) return { row, header };
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const MAP_DIR  = process.argv[2] || join(ROOT, 'data/raw/maps/Tech/1b219');
const MAP_KEY  = MAP_DIR.split('/').pop();

console.log(`\nParity check on map: ${MAP_KEY}`);
console.log('='.repeat(60));

// 1. Read map files
const datasetPath = join(MAP_DIR, '_dataset.json');
const dataset     = JSON.parse(await readFile(datasetPath, 'utf8'));
const { characteristic, difficulty, bpm } = dataset;

const infoDatRaw = await readFile(join(MAP_DIR, 'Info.dat'), 'utf8').catch(
  () => readFile(join(MAP_DIR, 'info.dat'), 'utf8')
);
const infoDat = JSON.parse(infoDatRaw);
const datFile = findDatFilename(infoDat, characteristic, difficulty);
const datJson = JSON.parse(await readFile(join(MAP_DIR, datFile), 'utf8'));

// 2. Parse beatmap
const { notes, obstacles, arcs, chains, bombs } = parseBeatmap(datJson);
console.log(`Parsed: ${notes.length} notes, ${obstacles.length} obstacles, ${bombs.length} bombs`);

// 3. Compute JS features
const jsFeats = computeFeatures(notes, obstacles, arcs, chains, parseFloat(bpm), bombs);

// 4. Load Python reference
const ref = await loadPythonRef(MAP_KEY);
if (!ref) {
  console.error(`Map ${MAP_KEY} not found in pattern_features.csv`);
  console.log('\nRunning inference only (no Python reference to compare)...');
} else {
  const { row, header } = ref;
  const META_PATH = join(__dirname, 'models/pattern_classifier_meta.json');
  const meta = JSON.parse(await readFile(META_PATH, 'utf8'));

  // Compare each feature in the model's feature list
  let maxDiff = 0, nMismatch = 0;
  const mismatches = [];

  for (const feat of meta.features) {
    if (!(feat in row)) continue;   // not in CSV
    const pyVal = parseFloat(row[feat]);
    const jsVal = jsFeats[feat] ?? 0;

    // Skip NaN in Python reference (imputed later)
    if (!isFinite(pyVal)) continue;

    const diff = Math.abs(pyVal - jsVal);
    if (diff > maxDiff) maxDiff = diff;
    if (diff > 1e-3) {
      nMismatch++;
      mismatches.push({ feat, py: pyVal, js: jsVal, diff });
    }
  }

  console.log(`\nFeature comparison (${meta.features.length} features):`);
  console.log(`  Max absolute diff: ${maxDiff.toExponential(3)}`);
  console.log(`  Mismatches >1e-3:  ${nMismatch}`);

  if (mismatches.length) {
    console.log('\n  Top mismatches:');
    mismatches.slice(0, 10).forEach(({ feat, py, js, diff }) =>
      console.log(`    ${feat.padEnd(40)} py=${py.toFixed(6)}  js=${js.toFixed(6)}  Δ=${diff.toExponential(2)}`)
    );
  } else {
    console.log('  ✓ All features match within 1e-3');
  }
}

// 5. End-to-end inference
console.log('\nRunning inference...');
const clf = await loadClassifier(
  join(__dirname, 'models/pattern_classifier.onnx'),
  join(__dirname, 'models/pattern_classifier_meta.json'),
);
const result = await classifyFromNotes(notes, obstacles, arcs, chains, parseFloat(bpm), bombs, clf);

console.log('\nResult:');
console.log(`  Category:   ${result.category}`);
console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
console.log('  Probabilities:');
for (const [cat, prob] of Object.entries(result.probabilities).sort((a,b) => b[1]-a[1])) {
  const bar = '█'.repeat(Math.round(prob * 20));
  console.log(`    ${cat.padEnd(12)} ${(prob * 100).toFixed(1).padStart(5)}%  ${bar}`);
}
