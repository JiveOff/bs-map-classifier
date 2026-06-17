'use strict';
/**
 * beatsaver.js — BeatSaver download helpers.
 *
 * Fetches a map zip from BeatSaver (by short key or zip hash), extracts the
 * correct difficulty .dat file, and returns a ready-to-classify parsed beatmap.
 *
 * Exported from the `bs-map-classifier/beatsaver` subpath.
 */

import { unzipSync } from 'fflate';
import { parseBeatmap, findDatInfo } from './parser.js';

const BS_API = 'https://beatsaver.com/api/maps';
const BS_CDN = 'https://cdn.beatsaver.com';

const RANK = { ExpertPlus: 5, Expert: 4, Hard: 3, Normal: 2, Easy: 1 };

const decode = buf => new TextDecoder().decode(buf);

function getZipEntry(zip, name) {
  const key = Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? zip[key] : null;
}

/**
 * Given pairs from the BeatSaver API or Info.dat, resolve the best
 * characteristic + difficulty, defaulting to Standard / highest ranked.
 */
function resolveDiff(pairs, characteristic = 'Standard', difficulty) {
  if (!pairs.length) return { characteristic, difficulty: difficulty ?? 'ExpertPlus' };

  const charPairs = pairs.filter(p => p.characteristic === characteristic);
  const pool      = charPairs.length ? charPairs : pairs; // fall back if char not found

  if (difficulty) {
    const exact = pool.find(p => p.difficulty === difficulty);
    if (exact) return { characteristic: pool[0].characteristic, difficulty };
  }

  const best = [...pool].sort((a, b) => (RANK[b.difficulty] ?? 0) - (RANK[a.difficulty] ?? 0))[0];
  return { characteristic: best.characteristic, difficulty: best.difficulty };
}

function pairsFromInfoDat(infoDat) {
  const pairs = [];
  for (const s of infoDat._difficultyBeatmapSets ?? []) {
    for (const d of s._difficultyBeatmaps ?? [])
      pairs.push({ characteristic: s._beatmapCharacteristicName, difficulty: d._difficulty });
  }
  for (const d of infoDat.difficultyBeatmaps ?? [])
    pairs.push({ characteristic: d.characteristic ?? 'Standard', difficulty: d.difficulty });
  return pairs;
}

async function extractAndParse(hash, bsInfo, characteristic, difficulty) {
  const zipBuf = await fetch(`${BS_CDN}/${hash}.zip`)
    .then(r => { if (!r.ok) throw new Error(`BeatSaver CDN ${r.status} for hash ${hash}`); return r.arrayBuffer(); });

  const zip     = unzipSync(new Uint8Array(zipBuf));
  const infoRaw = getZipEntry(zip, 'Info.dat') ?? getZipEntry(zip, 'info.dat');
  if (!infoRaw) throw new Error('Info.dat not found in zip');

  const infoDat = JSON.parse(decode(infoRaw));
  const bpm     = bsInfo?.metadata?.bpm ?? infoDat._beatsPerMinute ?? 120;

  // Prefer pairs from BS API (has all chars/diffs); fall back to Info.dat
  const apiPairs = bsInfo?.versions?.at(-1)?.diffs ?? [];
  const pairs    = apiPairs.length ? apiPairs : pairsFromInfoDat(infoDat);
  const resolved = resolveDiff(pairs, characteristic, difficulty);

  const { filename, njs, njsOffset } = findDatInfo(infoDat, resolved.characteristic, resolved.difficulty);
  const datRaw = getZipEntry(zip, filename);
  if (!datRaw) throw new Error(`"${filename}" not found in zip`);

  const beatmap = {
    ...parseBeatmap(JSON.parse(decode(datRaw))),
    njs,
    njsOffset,
  };

  return {
    beatmap,
    bpm,
    njs,
    njsOffset,
    characteristic: resolved.characteristic,
    difficulty:     resolved.difficulty,
    songName:   bsInfo?.metadata?.songName        ?? infoDat._songName        ?? '',
    songAuthor: bsInfo?.metadata?.songAuthorName  ?? infoDat._songAuthorName  ?? '',
    mapAuthor:  bsInfo?.metadata?.levelAuthorName ?? infoDat._levelAuthorName ?? '',
  };
}

/**
 * Download and parse a Beat Saber map by its BeatSaver short key (e.g. "2b120").
 *
 * @param {string}  key            - BeatSaver map key
 * @param {string}  [characteristic='Standard']
 * @param {string}  [difficulty]   - defaults to highest available
 */
export async function loadFromKey(key, characteristic = 'Standard', difficulty) {
  const r = await fetch(`${BS_API}/id/${key}`);
  if (!r.ok) throw new Error(`BeatSaver: map "${key}" not found (${r.status})`);
  const bsInfo = await r.json();
  const hash   = bsInfo.versions?.at(-1)?.hash;
  if (!hash) throw new Error(`BeatSaver: no versions found for "${key}"`);
  return extractAndParse(hash, bsInfo, characteristic, difficulty);
}

/**
 * Download and parse a Beat Saber map by its zip hash.
 * Metadata (song name, author, BPM) is fetched from the API when possible.
 *
 * @param {string}  hash           - BeatSaver version hash (40-char hex)
 * @param {string}  [characteristic='Standard']
 * @param {string}  [difficulty]   - defaults to highest available
 */
export async function loadFromHash(hash, characteristic = 'Standard', difficulty) {
  let bsInfo = null;
  try {
    const r = await fetch(`${BS_API}/hash/${hash}`);
    if (r.ok) bsInfo = await r.json();
  } catch { /* metadata is optional */ }
  return extractAndParse(hash, bsInfo, characteristic, difficulty);
}
