'use strict';
/**
 * bs-map-classifier — public API
 *
 * Classify a Beat Saber map into one of:
 *   Tech | Speed | Accuracy | Standard | Extreme
 *
 * Quick start (Node.js):
 *
 *   import { loadClassifier, extractPatternsAndClassifyMap } from 'bs-map-classifier';
 *   import { parseBeatmap } from 'bs-map-classifier/parser';
 *
 *   const clf = await loadClassifier('./models/pattern_classifier.onnx',
 *                                    './models/pattern_classifier_meta.json');
 *   const beatmap = parseBeatmap(datJson);
 *   const result  = await extractPatternsAndClassifyMap(beatmap, bpm, clf);
 *   // result.classification.category  → 'Tech'
 *   // result.patterns                 → [{type, label, beat, notes}, ...]
 *   // result.features                 → {lane_0_rate, ebpm_left_mean, ...}
 *
 * Browser (fetch-based):
 *   import { setOrtInstance, setWasmPaths, loadClassifierFromFetch } from 'bs-map-classifier';
 *   setOrtInstance(window.ort);  // if ort.min.js is loaded as a script tag
 *   await setWasmPaths('/wasm/');
 *   const clf = await loadClassifierFromFetch('/models/pattern_classifier.onnx',
 *                                             '/models/pattern_classifier_meta.json');
 */

export {
  loadClassifier, loadClassifierFromFetch, loadClassifierFromBuffers,
  classifyFromNotes, preprocess,
  setOrtInstance, setWasmPaths,
} from './classify.js';
export { computeFeatures, toFeatureVector } from './features.js';
export { parseBeatmap, findDatFilename }    from './parser.js';
export { annotatePatterns, PATTERN_COLORS, TYPE_LABELS } from './patterns.js';
export { extractPatterns, classifyMap, extractPatternsAndClassifyMap, parseMap } from './map.js';
