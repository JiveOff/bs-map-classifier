'use strict';
/**
 * classify.node.js — Node.js variant.
 *
 * Lazy-loads onnxruntime-node (native/CPU) first, then falls back to
 * onnxruntime-web (WASM) automatically when the native addon cannot be loaded
 * (e.g. sandbox environments where native addons are disabled).
 *
 * The execution provider is chosen to match the runtime that loaded:
 *   onnxruntime-node → 'cpu'
 *   onnxruntime-web  → 'wasm'
 *
 * To force WASM from the start (skipping the native attempt):
 *   import * as ort from 'onnxruntime-web';
 *   import { setOrtInstance } from 'bs-map-classifier/classify';
 *   setOrtInstance(ort, 'wasm');
 */

export { preprocess, classifyFromNotes } from './infer.js';

let _ort      = null;
let _provider = 'cpu';

/** Override the ORT runtime instance and, optionally, the execution provider. */
export function setOrtInstance(ort, provider = 'wasm') {
  _ort      = ort;
  _provider = provider;
}

/** Set WASM file paths (needed when using onnxruntime-web in Node.js). */
export async function setWasmPaths(wasmDir) {
  const ort = await _loadOrt();
  ort.env.wasm.wasmPaths = wasmDir;
}

async function _loadOrt() {
  if (_ort) return _ort;
  try {
    _ort      = await import('onnxruntime-node');
    _provider = 'cpu';
    return _ort;
  } catch {}
  try {
    _ort      = await import('onnxruntime-web');
    _provider = 'wasm';
    return _ort;
  } catch {}
  throw new Error(
    'No ONNX runtime found. Install onnxruntime-node (native) or onnxruntime-web (WASM).'
  );
}

export async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import('node:fs/promises');
  const ort = await _loadOrt();
  const [modelBuf, metaText] = await Promise.all([
    readFile(modelPath),
    readFile(metaPath, 'utf8'),
  ]);
  const session = await ort.InferenceSession.create(modelBuf, { executionProviders: [_provider] });
  return { session, meta: JSON.parse(metaText), ort };
}

export async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const ort = await _loadOrt();
  const [modelResp, metaResp] = await Promise.all([fetch(modelUrl), fetch(metaUrl)]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok)  throw new Error(`Failed to fetch meta: ${metaResp.status}`);
  const [modelBuf, meta] = await Promise.all([modelResp.arrayBuffer(), metaResp.json()]);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: [_provider] });
  return { session, meta, ort };
}

export async function loadClassifierFromBuffers(modelBuffer, meta) {
  const ort = await _loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: [_provider] });
  return { session, meta, ort };
}
