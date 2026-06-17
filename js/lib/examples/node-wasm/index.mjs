import * as ort from 'onnxruntime-web';
import { setOrtInstance, setWasmPaths, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { loadFromKey } from 'bs-map-classifier/beatsaver';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';

await setWasmPaths(new URL('./node_modules/onnxruntime-web/dist/', import.meta.url).href);
setOrtInstance(ort, 'wasm');

const MAP_KEY        = '2b120';
const CHARACTERISTIC = 'Standard';
const DIFFICULTY     = 'ExpertPlus';

console.log(`Fetching map ${MAP_KEY}…`);

const [classifier, { beatmap, bpm, songName, songAuthor }] = await Promise.all([
  loadEmbeddedClassifier(),
  loadFromKey(MAP_KEY, CHARACTERISTIC, DIFFICULTY),
]);

console.log(`Classifying "${songName}"…`);

const { classification, features, patterns } = await extractPatternsAndClassifyMap(beatmap, bpm, classifier);

console.log('');
console.log(`"${songName}" by ${songAuthor} — ${CHARACTERISTIC}/${DIFFICULTY}`);
console.log(`Category:   ${classification.category}`);
console.log(`Confidence: ${(classification.confidence * 100).toFixed(1)}%`);
console.log('');
for (const [cls, p] of Object.entries(classification.probabilities).sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.round(p * 20)).padEnd(20, '░');
  console.log(`  ${cls.padEnd(10)} ${bar} ${(p * 100).toFixed(1)}%`);
}
console.log('');
console.log(`NJS ${features.njs}  JD ${features.jump_distance?.toFixed(2)}  RT ${(features.reaction_time * 1000)?.toFixed(0)}ms  NPS ${features.nps_mapped?.toFixed(2)}  Patterns ${patterns.length}`);
