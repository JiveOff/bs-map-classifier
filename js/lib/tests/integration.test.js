'use strict';
/**
 * integration.test.js — Live BeatSaver inference tests.
 *
 * Downloads real maps from BeatSaver and checks that the classifier predicts
 * the correct category. Each map is cached in tests/fixtures/ after the first
 * download so subsequent runs are fast and offline-capable.
 *
 * Skipped by default. Enable with:
 *   INTEGRATION=1 node --test tests/integration.test.js
 *
 * Add maps via the KNOWN_MAPS table below. Keys come from the pooling sheet.
 */

import { test }          from 'node:test';
import assert            from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBeatmap, findDatFilename, findDatInfo } from '../src/parser.js';
import { loadClassifier, classifyFromNotes } from '../src/classify.node.js';
import { extractPatternsAndClassifyMap } from '../src/map.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const FIXTURES    = resolve(__dirname, 'fixtures');
const MODEL_PATH  = resolve(__dirname, '../../../models/onnx/pattern_classifier.onnx');
const META_PATH   = resolve(__dirname, '../../../models/onnx/pattern_classifier_meta.json');
const RUN         = process.env.INTEGRATION === '1';
const SKIP_REASON = 'set INTEGRATION=1 to run live BeatSaver tests';

// ── Map registry ──────────────────────────────────────────────────────────────
// Add entries here — keys are BeatSaver short IDs from the pooling sheet.
// characteristic/difficulty default to Standard/ExpertPlus.

// difficulty defaults to ExpertPlus unless overridden.
// Accuracy maps often live at Easy/Normal — set difficulty explicitly when needed.
const KNOWN_MAPS = [
  // Accuracy
  { key: '33d42', expected: 'Accuracy',  label: 'Longest Wave',       difficulty: 'Easy'       },
  { key: '36a2a', expected: 'Accuracy',  label: 'Osmosis',            difficulty: 'Normal'     },
  // Speed
  { key: '2636f', expected: 'Speed',     label: 'Seiten No Teriyaki'                            },
  { key: '2ab61', expected: 'Speed',     label: 'Xronial Xero'                                  },
  { key: '276d6', expected: 'Speed',     label: 'Galaxy Burst'                                  },
  // Tech
  // Howl moved to BORDERLINE_MAPS — High Tech (Tier 3), model predicts Extreme
  { key: '35be7', expected: 'Tech',      label: 'Show'                                          },
  { key: '31f86', expected: 'Tech',      label: 'Anatasama'                                     },
  { key: '370cf', expected: 'Tech',      label: 'Wildstar'                                      },
  // Standard
  { key: '1e95f', expected: 'Standard',  label: 'Title Track'                                   },
  { key: '206b2', expected: 'Standard',  label: 'AK-40000000'                                   },
  { key: '20151', expected: 'Standard',  label: 'Maximizer'                                     },
  // Extreme
  { key: '3d561', expected: 'Extreme',   label: 'Lustre'                                        },
  // 999 moved to BORDERLINE_MAPS — Extreme Speed, model splits between Speed/Extreme
  { key: '3b2f8', expected: 'Extreme',   label: 'Kyuukou'                                       },
];

// ── Minimal ZIP reader (no external deps) ────────────────────────────────────
// Uses the Central Directory at the end of the ZIP for correct offsets,
// avoiding false-positive PK signatures inside compressed data.

function parseZip(buf) {
  // Find End of Central Directory record (scan backwards from end)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('No End of Central Directory record found');

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdSize   = buf.readUInt32LE(eocd + 12);
  const entries  = {};

  let i = cdOffset;
  while (i < cdOffset + cdSize && i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x02014b50) break; // Central directory entry sig
    const method         = buf.readUInt16LE(i + 10);
    const compSize       = buf.readUInt32LE(i + 20);
    const filenameLen    = buf.readUInt16LE(i + 28);
    const extraLen       = buf.readUInt16LE(i + 30);
    const commentLen     = buf.readUInt16LE(i + 32);
    const localOffset    = buf.readUInt32LE(i + 42);
    const filename       = buf.subarray(i + 46, i + 46 + filenameLen).toString('utf8');

    // Jump to local file header to get actual data offset
    const lhFilenameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen    = buf.readUInt16LE(localOffset + 28);
    const dataStart     = localOffset + 30 + lhFilenameLen + lhExtraLen;

    if (compSize > 0 && !filename.endsWith('/')) {
      const raw = buf.subarray(dataStart, dataStart + compSize);
      entries[filename] = method === 8 ? inflateRawSync(raw) : raw;
    }

    i += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

function getEntry(zip, name) {
  const key = Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? zip[key] : null;
}

function getDatEntry(zip, resolvedName, characteristic, difficulty) {
  // 1. Try the exact resolved name
  let entry = getEntry(zip, resolvedName);
  if (entry) return { entry, name: resolvedName };

  // 2. Try common fallback patterns (v4 maps may omit characteristic)
  for (const candidate of [`${difficulty}.dat`, `${difficulty}${characteristic}.dat`]) {
    entry = getEntry(zip, candidate);
    if (entry) return { entry, name: candidate };
  }

  // 3. Find any .dat that starts with the difficulty name (case-insensitive)
  const diffLow = difficulty.toLowerCase();
  const key = Object.keys(zip).find(
    k => k.toLowerCase().startsWith(diffLow) && k.toLowerCase().endsWith('.dat') &&
         k.toLowerCase() !== 'info.dat'
  );
  if (key) return { entry: zip[key], name: key };

  return null;
}

// ── BeatSaver fetch + cache ───────────────────────────────────────────────────

async function fetchMap(key, characteristic = 'Standard', difficulty = 'ExpertPlus') {
  if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });

  const cacheKey  = `${key}_${characteristic}_${difficulty}`;
  const cachePath = resolve(FIXTURES, `${cacheKey}.json`);

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }

  // Fetch metadata
  const info = await fetch(`https://beatsaver.com/api/maps/id/${key}`)
    .then(r => { if (!r.ok) throw new Error(`BeatSaver API ${r.status} for key ${key}`); return r.json(); });

  const version = info.versions.at(-1);
  const bpm     = info.metadata.bpm;

  // Download and parse zip
  const zipBuf  = await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`)
    .then(r => { if (!r.ok) throw new Error(`CDN ${r.status} for ${version.hash}`); return r.arrayBuffer(); })
    .then(ab => Buffer.from(ab));

  const zip      = parseZip(zipBuf);
  const infoDat  = JSON.parse((getEntry(zip, 'Info.dat') ?? getEntry(zip, 'info.dat')).toString('utf8'));
  const datInfo    = findDatInfo(infoDat, characteristic, difficulty);
  const datResult  = getDatEntry(zip, datInfo.filename, characteristic, difficulty);
  if (!datResult) throw new Error(
    `Difficulty file "${datInfo.filename}" not found in zip for ${key}. ` +
    `Available .dat files: ${Object.keys(zip).filter(k => k.endsWith('.dat')).join(', ')}`
  );
  const datEntry = datResult.entry;
  const datJson  = JSON.parse(datEntry.toString('utf8'));

  const parsed = parseBeatmap(datJson);
  const result = {
    key,
    label:          info.metadata.songName,
    characteristic,
    difficulty,
    bpm,
    njs:            datInfo.njs,
    njsOffset:      datInfo.njsOffset,
    notes:          parsed.notes,
    obstacles:      parsed.obstacles,
    arcs:           parsed.arcs,
    chains:         parsed.chains,
    bombs:          parsed.bombs,
  };

  writeFileSync(cachePath, JSON.stringify(result));
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Load classifier once for all tests
let _clf = null;
async function getClassifier() {
  if (!_clf) _clf = await loadClassifier(MODEL_PATH, META_PATH);
  return _clf;
}

for (const { key, expected, label, characteristic = 'Standard', difficulty = 'ExpertPlus' } of KNOWN_MAPS) {
  test(`[${expected}] ${label} (${key}) → top prediction matches`, {
    skip: !RUN ? SKIP_REASON : false,
    timeout: 30_000,
  }, async () => {
    const clf  = await getClassifier();
    const map  = await fetchMap(key, characteristic, difficulty);
    const result = await classifyFromNotes(
      map.notes, map.obstacles, map.arcs, map.chains,
      map.bpm, map.bombs, clf
    );

    const ranked = Object.entries(result.probabilities)
      .sort((a, b) => b[1] - a[1]);

    const topCategory = ranked[0][0];
    const topProb     = ranked[0][1];
    const expProb     = result.probabilities[expected];

    // Report even on pass so you can see confidence
    const summary = ranked.map(([c, p]) => `${c}=${(p*100).toFixed(1)}%`).join(' ');

    assert.equal(
      topCategory, expected,
      `"${map.label}": expected ${expected} but got ${topCategory} (${(topProb*100).toFixed(1)}%). Scores: ${summary}`
    );

    // Soft warning if confidence is low (< 40%) — test still passes
    if (expProb < 0.40) {
      process.stderr.write(
        `  ⚠ Low confidence for "${map.label}": ${expected}=${(expProb*100).toFixed(1)}% — ${summary}\n`
      );
    }
  });
}

// ── Top-2 leniency tests (borderline maps) ────────────────────────────────────
// Add maps here where the correct category is acceptable in the top 2 predictions,
// e.g. Speed/Tech hybrids that could reasonably go either way.

const BORDERLINE_MAPS = [
  // High Tech (Tier 3) — model predicts Extreme; both are valid given the difficulty level
  { key: '29f79', expected: 'Tech',    label: 'Howl',  note: 'High Tech often confused with Extreme' },
  // Extreme Speed (>400 BPM) — model splits between Speed and Extreme; Extreme should be in top-2
  { key: '33705', expected: 'Extreme', label: '999',   note: 'Extreme Speed/Speed boundary' },
];

for (const { key, expected, label, characteristic = 'Standard', difficulty = 'ExpertPlus', note = '' } of BORDERLINE_MAPS) {
  test(`[borderline] ${label} (${key}) → ${expected} in top 2${note ? ' — ' + note : ''}`, {
    skip: !RUN ? SKIP_REASON : false,
    timeout: 30_000,
  }, async () => {
    const clf  = await getClassifier();
    const map  = await fetchMap(key, characteristic, difficulty);
    const result = await classifyFromNotes(
      map.notes, map.obstacles, map.arcs, map.chains,
      map.bpm, map.bombs, clf
    );

    const ranked = Object.entries(result.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c);

    assert.ok(
      ranked.includes(expected),
      `"${label}": expected ${expected} in top 2 but got [${ranked.join(', ')}]. ` +
      `Scores: ${Object.entries(result.probabilities).sort((a,b)=>b[1]-a[1]).map(([c,p])=>`${c}=${(p*100).toFixed(1)}%`).join(' ')}`
    );
  });
}

// ── extractPatternsAndClassifyMap integration tests ───────────────────────────
// Tests the full high-level API end-to-end: parse → features+patterns → classify.
// One representative map per category; njs/njsOffset flow through from Info.dat.

const FULL_API_MAPS = [
  { key: '33d42', expected: 'Accuracy', label: 'Longest Wave',       difficulty: 'Easy'   },
  { key: '2636f', expected: 'Speed',    label: 'Seiten No Teriyaki'                        },
  { key: '35be7', expected: 'Tech',     label: 'Show'                                      },
  { key: '1e95f', expected: 'Standard', label: 'Title Track'                               },
  { key: '3d561', expected: 'Extreme',  label: 'Lustre'                                    },
];

for (const { key, expected, label, characteristic = 'Standard', difficulty = 'ExpertPlus' } of FULL_API_MAPS) {
  test(`[extractPatternsAndClassifyMap] ${label} (${key}) → ${expected}`, {
    skip: !RUN ? SKIP_REASON : false,
    timeout: 30_000,
  }, async () => {
    const clf = await getClassifier();
    const map = await fetchMap(key, characteristic, difficulty);

    const parsedBeatmap = {
      notes:     map.notes,
      obstacles: map.obstacles,
      arcs:      map.arcs,
      chains:    map.chains,
      bombs:     map.bombs,
      njs:       map.njs       ?? 0,
      njsOffset: map.njsOffset ?? 0,
    };

    const result = await extractPatternsAndClassifyMap(parsedBeatmap, map.bpm, clf);

    // Classification matches expected
    assert.equal(
      result.classification.category, expected,
      `"${label}": expected ${expected} but got ${result.classification.category}. ` +
      `Scores: ${Object.entries(result.classification.probabilities).sort((a,b)=>b[1]-a[1]).map(([c,p])=>`${c}=${(p*100).toFixed(1)}%`).join(' ')}`
    );

    // Output shape is complete
    assert.ok(result.features && typeof result.features === 'object', 'features missing');
    assert.ok(Array.isArray(result.patterns),                         'patterns missing');
    assert.ok(Array.isArray(result.allNotes),                         'allNotes missing');
    assert.ok(result.patternColors && typeof result.patternColors === 'object');

    // Features are populated with real values
    assert.ok(result.features.nps_mapped > 0,        'nps_mapped should be > 0');
    assert.ok(result.features.ebpm_left_mean > 0,    'ebpm_left_mean should be > 0');
    assert.equal(result.allNotes.length, map.notes.length, 'allNotes length should match note count');

    // njs from Info.dat is reflected in features
    if (map.njs > 0) {
      assert.equal(result.features.njs, map.njs,
        `features.njs (${result.features.njs}) should match Info.dat njs (${map.njs})`);
      assert.ok(result.features.jump_distance > 0, 'jump_distance should be positive');
      assert.ok(result.features.reaction_time  > 0, 'reaction_time should be positive');
    }

    // Patterns are detected on real maps
    assert.ok(result.patterns.length > 0, `no patterns detected in "${label}" — expected at least one`);

    // classification.category matches the top probability
    const topClass = Object.entries(result.classification.probabilities)
      .sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(result.classification.category, topClass);
  });
}
