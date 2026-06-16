'use strict';
/**
 * bs-map-classifier — public API
 *
 * Classify a Beat Saber map into one of:
 *   Tech | Speed | Accuracy | Standard | Extreme
 *
 * Quick start (Node.js):
 *
 *   import { loadClassifier, parseMap } from 'bs-map-classifier';
 *   import { parseBeatmap } from 'bs-map-classifier/parser';
 *
 *   const clf = await loadClassifier('./models/pattern_classifier.onnx',
 *                                    './models/pattern_classifier_meta.json');
 *   const beatmap = parseBeatmap(datJson);
 *   const result  = await parseMap(beatmap, bpm, clf);
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

import { computeFeatures, toFeatureVector } from './features.js';
import { classifyFromNotes } from './classify.js';
import { annotatePatterns } from './patterns.js';

export {
  loadClassifier, loadClassifierFromFetch, loadClassifierFromBuffers,
  classifyFromNotes, preprocess,
  setOrtInstance, setWasmPaths,
} from './classify.js';
export { computeFeatures, toFeatureVector } from './features.js';
export { parseBeatmap, findDatFilename }    from './parser.js';
export { annotatePatterns, PATTERN_COLORS, TYPE_LABELS } from './patterns.js';

/**
 * High-level convenience: parse a beatmap, extract all patterns, and optionally classify.
 *
 * @param {{ notes, obstacles, arcs, chains, bombs }} parsedBeatmap
 * @param {number}  bpm
 * @param {object}  [classifier]  - from loadClassifier / loadClassifierFromFetch
 * @param {object}  [meta]        - optional metadata for the pattern annotation
 * @returns {{ features, patterns, patternColors, classification? }}
 */
export async function parseMap(parsedBeatmap, bpm, classifier = null, meta = {}) {
  const { notes, obstacles = [], arcs = [], chains = [], bombs = [] } = parsedBeatmap;

  const features   = computeFeatures(notes, obstacles, arcs, chains, bpm, bombs);
  const annotation = annotatePatterns(notes, bpm, meta);

  const result = {
    features,
    patterns:     annotation.patterns,
    patternColors: annotation.colors,
    allNotes:     annotation.all_notes,
  };

  if (classifier) {
    result.classification = await classifyFromNotes(
      notes, obstacles, arcs, chains, bpm, bombs, classifier,
    );
  }

  return result;
}
