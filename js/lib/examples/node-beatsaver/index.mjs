import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import { parseBeatmap, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { findDatInfo } from 'bs-map-classifier/parser';

const require = createRequire(import.meta.url);
const { loadEmbeddedClassifier } = require('bs-map-classifier/embedded');

const MAP_KEY        = '2b120';
const CHARACTERISTIC = 'Standard';
const DIFFICULTY     = 'ExpertPlus';

console.log(`Fetching map ${MAP_KEY}…`);

const [classifier, info] = await Promise.all([
  loadEmbeddedClassifier(),
  fetch(`https://beatsaver.com/api/maps/id/${MAP_KEY}`)
    .then(r => { if (!r.ok) throw new Error(`BeatSaver API ${r.status}`); return r.json(); }),
]);

const version = info.versions.at(-1);
console.log(`Downloading "${info.metadata.songName}"…`);

const zipBuf = await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`)
  .then(r => { if (!r.ok) throw new Error(`CDN ${r.status}`); return r.arrayBuffer(); });
const zip    = unzipSync(new Uint8Array(zipBuf));

const getEntry = name => {
  const key = Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? zip[key] : null;
};

const infoDat = JSON.parse(new TextDecoder().decode(getEntry('Info.dat') ?? getEntry('info.dat')));
const { filename, njs, njsOffset } = findDatInfo(infoDat, CHARACTERISTIC, DIFFICULTY);
const datFile = JSON.parse(new TextDecoder().decode(getEntry(filename)));

const { classification, features, patterns } = await extractPatternsAndClassifyMap(
  parseBeatmap(datFile), info.metadata.bpm, classifier, {}, njs, njsOffset,
);

console.log('');
console.log(`"${info.metadata.songName}" — ${CHARACTERISTIC}/${DIFFICULTY}`);
console.log(`Category:   ${classification.category}`);
console.log(`Confidence: ${(classification.confidence * 100).toFixed(1)}%`);
console.log('');
for (const [cls, p] of Object.entries(classification.probabilities).sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.round(p * 20)).padEnd(20, '░');
  console.log(`  ${cls.padEnd(10)} ${bar} ${(p * 100).toFixed(1)}%`);
}
console.log('');
console.log(`NJS ${features.njs}  JD ${features.jump_distance?.toFixed(2)}  RT ${(features.reaction_time * 1000)?.toFixed(0)}ms  NPS ${features.nps_mapped?.toFixed(2)}  Patterns ${patterns.length}`);
