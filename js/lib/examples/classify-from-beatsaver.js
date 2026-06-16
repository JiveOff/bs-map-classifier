import * as ort from 'onnxruntime-web';
import { unzipSync } from 'fflate';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import { setOrtInstance, parseBeatmap, findDatFilename, extractPatternsAndClassifyMap } from 'bs-map-classifier';

setOrtInstance(ort);

const MAP_KEY        = '2b120';
const CHARACTERISTIC = 'Standard';
const DIFFICULTY     = 'ExpertPlus';

const info    = await fetch(`https://beatsaver.com/api/maps/id/${MAP_KEY}`).then(r => r.json());
const version = info.versions.at(-1);
const diff    = version.diffs.find(d => d.characteristic === CHARACTERISTIC && d.difficulty === DIFFICULTY);

const zip     = unzipSync(new Uint8Array(await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`).then(r => r.arrayBuffer())));
const get     = name => zip[Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase())];
const infoDat = JSON.parse(Buffer.from(get('Info.dat')).toString());
const datFile = JSON.parse(Buffer.from(get(findDatFilename(infoDat, CHARACTERISTIC, DIFFICULTY))).toString());

const classifier = await loadEmbeddedClassifier();
const { classification } = await extractPatternsAndClassifyMap(parseBeatmap(datFile), info.metadata.bpm, classifier);

console.log(`"${info.metadata.songName}" — ${CHARACTERISTIC}/${DIFFICULTY}`);
console.log(`Category: ${classification.category} (${(classification.confidence * 100).toFixed(1)}%)`);
console.log(Object.entries(classification.probabilities).sort((a, b) => b[1] - a[1])
  .map(([cls, p]) => `  ${cls.padEnd(10)} ${'█'.repeat(Math.round(p * 20)).padEnd(20, '░')} ${(p * 100).toFixed(1)}%`)
  .join('\n'));
