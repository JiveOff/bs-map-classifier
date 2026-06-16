'use strict';
/**
 * classify.js — ONNX inference pipeline for the Beat Saber map classifier.
 *
 * Works in Node.js and browser. No top-level Node.js imports — all I/O is
 * done via dynamic imports inside loader functions so the module can be
 * bundled for browser use without modification.
 *
 * Node.js:
 *   const clf = await loadClassifier('./models/pattern_classifier.onnx',
 *                                    './models/pattern_classifier_meta.json');
 *
 * Browser (or any fetch-capable environment):
 *   const clf = await loadClassifierFromFetch(
 *     '/models/pattern_classifier.onnx',
 *     '/models/pattern_classifier_meta.json',
 *   );
 *
 * Browser (pre-loaded buffers, e.g. from a bundler or service worker):
 *   const clf = await loadClassifierFromBuffers(modelArrayBuffer, metaObject);
 *
 *   const result = await classifyFromNotes(notes, obstacles, arcs, chains, bpm, [], clf);
 *   // { category: 'Tech', confidence: 0.82, probabilities: { Accuracy: 0.03, ... } }
 */

export { preprocess, classifyFromNotes } from './infer.js';

// ── ORT instance injection (allows bypassing dynamic import in bundled contexts) ─

let _injectedOrt = null;

/** Inject an already-loaded ORT runtime (e.g. `window.ort` from ort.min.js). */
export function setOrtInstance(ort) { _injectedOrt = ort; }

/** Set WASM file paths on the ORT runtime before any session is created. */
export async function setWasmPaths(wasmDir) {
  const ort = _injectedOrt ?? await _loadOrt();
  ort.env.wasm.wasmPaths = wasmDir;
}

// ── Runtime detection ─────────────────────────────────────────────────────────

async function _loadOrt() {
  if (_injectedOrt) return _injectedOrt;
  // Try Node.js runtime first, then browser runtime
  try { return await import('onnxruntime-node'); } catch {}
  try { return await import('onnxruntime-web');  } catch {}
  throw new Error(
    'No ONNX runtime found. Install onnxruntime-node (Node.js) ' +
    'or onnxruntime-web (browser).'
  );
}

// ── Model loading ─────────────────────────────────────────────────────────────

async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import('node:fs/promises');
  const ort = await _loadOrt();
  const [modelBuf, metaText] = await Promise.all([
    readFile(modelPath),
    readFile(metaPath, 'utf8'),
  ]);
  const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
  return { session, meta: JSON.parse(metaText), ort };
}

async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const ort = await _loadOrt();
  const [modelResp, metaResp] = await Promise.all([fetch(modelUrl), fetch(metaUrl)]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok)  throw new Error(`Failed to fetch meta: ${metaResp.status}`);
  const [modelBuf, meta] = await Promise.all([modelResp.arrayBuffer(), metaResp.json()]);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}

async function loadClassifierFromBuffers(modelBuffer, meta) {
  const ort = await _loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}

export { loadClassifier, loadClassifierFromFetch, loadClassifierFromBuffers };
