/**
 * classify-node-wasm.js
 *
 * Minimal example: Use the classifier in Node.js with WASM backend via onnxruntime-web.
 * The embedded model is bundled, so no external model files are needed.
 *
 * Run with: node examples/classify-node-wasm.js
 */

import * as ort from 'onnxruntime-web';
import { setOrtInstance, classifyFromNotes } from 'bs-map-classifier';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';

// Configure WASM backend
setOrtInstance(ort, 'wasm');

// Load the classifier (model is embedded in the library)
const classifier = await loadEmbeddedClassifier();

// Simple test with a few notes
const notes = [
  { time: 0, type: 'Note', cutDirection: 0, layer: 0, line: 0 },
  { time: 0.5, type: 'Note', cutDirection: 1, layer: 0, line: 1 },
  { time: 1, type: 'Note', cutDirection: 2, layer: 0, line: 2 },
  { time: 1.5, type: 'Note', cutDirection: 3, layer: 0, line: 3 },
];

const result = await classifyFromNotes(notes, [], [], [], 120, [], classifier);

console.log(`Category: ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
console.log('Probabilities:', result.probabilities);
