import * as ort from 'onnxruntime-web';
import { unzipSync } from 'fflate';
import { parseBeatmap, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { findDatInfo } from 'bs-map-classifier/parser';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import type { MapAnalysisResult } from 'bs-map-classifier';

ort.env.wasm.wasmPaths = new URL('./node_modules/onnxruntime-web/dist/', import.meta.url).href;
ort.env.wasm.numThreads = 1;

const MAP_KEY        = '2b120';
const CHARACTERISTIC = 'Standard';
const DIFFICULTY     = 'ExpertPlus';

interface BSResponse {
  metadata: { songName: string; songAuthorName: string; bpm: number }
  versions:  Array<{ hash: string }>
}

const decode   = (buf: Uint8Array): string => new TextDecoder().decode(buf);
const getEntry = (zip: Record<string, Uint8Array>, name: string): Uint8Array | null => {
  const key = Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? zip[key] : null;
};

console.log(`Fetching map ${MAP_KEY}…`);

const [classifier, info] = await Promise.all([
  loadEmbeddedClassifier(),
  fetch(`https://beatsaver.com/api/maps/id/${MAP_KEY}`)
    .then((r: Response) => { if (!r.ok) throw new Error(`BeatSaver API ${r.status}`); return r.json() as Promise<BSResponse>; }),
]);

const version = info.versions.at(-1)!;
console.log(`Downloading "${info.metadata.songName}"…`);

const zipBuf = await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`)
  .then((r: Response) => { if (!r.ok) throw new Error(`CDN ${r.status}`); return r.arrayBuffer(); });
const zip    = unzipSync(new Uint8Array(zipBuf));

const infoRaw = getEntry(zip, 'Info.dat') ?? getEntry(zip, 'info.dat');
if (!infoRaw) throw new Error('Info.dat not found');
const infoDat = JSON.parse(decode(infoRaw)) as object;

const { filename, njs, njsOffset } = findDatInfo(infoDat, CHARACTERISTIC, DIFFICULTY);
const datRaw = getEntry(zip, filename);
if (!datRaw) throw new Error(`${filename} not found in zip`);

const { classification, features, patterns }: MapAnalysisResult =
  await extractPatternsAndClassifyMap(parseBeatmap(JSON.parse(decode(datRaw))), info.metadata.bpm, classifier, {}, njs, njsOffset);

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
